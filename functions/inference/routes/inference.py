# functions/inference/routes/inference.py
"""
Inference route with Cloud Tasks retry handling.
"""
import logging
import time
import torch
import numpy as np
import requests
from io import BytesIO
from typing import Optional

import soundfile as sf
from flask import request, jsonify, g
from firebase_admin import firestore, storage
from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import ValidationError

from config import config
from utils.validators import validate_request, InferenceRequest
from utils.gcs_utils import upload_to_gcs, merge_audio_chunks_from_gcs, generate_signed_url
from utils import (
    detect_multi_speaker,
    format_text_for_vibevoice,
    map_speakers_to_voice_samples
)
from firebase.credits import (
    calculate_cost_from_duration,
    confirm_credit_deduction,
    release_credits
)
from middleware import update_job_status

logger = logging.getLogger(__name__)
db = firestore.client()

# Retry configuration (matches Cloud Tasks queue settings)
MAX_RETRY_ATTEMPTS = 2  # max_attempts=3 means 2 retries after initial attempt


def get_retry_info_from_headers(headers) -> tuple[int, bool, bool]:
    """
    Extract retry information from Cloud Tasks headers.
    
    Returns:
        (retry_count, is_retry, is_final_attempt)
    """
    retry_count = int(headers.get('X-CloudTasks-TaskRetryCount', '0'))
    is_retry = retry_count > 0
    is_final_attempt = retry_count >= MAX_RETRY_ATTEMPTS
    
    return retry_count, is_retry, is_final_attempt


def download_voice_sample_from_firebase(character_id: str) -> bytes:
    """Download voice sample from Firebase Storage."""
    try:
        char_doc = db.collection("characters").document(character_id).get()
        
        if not char_doc.exists:
            raise Exception(f"Character {character_id} not found")
        
        char_data = char_doc.to_dict()
        if not char_data:
            raise Exception(f"Character {character_id} has no data")
        
        sample_url = char_data.get("sampleAudioUrl")
        storage_path = char_data.get("sampleAudioStoragePath")
        
        if not sample_url and not storage_path:
            raise Exception(f"No audio sample found for character {character_id}")
        
        # Try direct URL first
        if sample_url and sample_url.startswith("http"):
            response = requests.get(sample_url, timeout=30)
            if response.status_code == 200:
                return response.content
        
        # Fall back to Storage path
        if storage_path:
            bucket = storage.bucket()
            blob = bucket.blob(storage_path)
            
            if not blob.exists():
                raise Exception(f"Audio file not found in storage: {storage_path}")
            
            return blob.download_as_bytes()
        
        raise Exception(f"Could not download audio for character {character_id}")
        
    except Exception as e:
        logger.error(f"Failed to download voice sample for {character_id}: {str(e)}")
        raise


def download_original_speaker_sample(job_id: str, speaker_id: str, job_type: str) -> bytes:
    """Download original speaker voice sample from job data."""
    try:
        if job_type == "dubbing":
            job_ref = db.collection("dubbingJobs").document(job_id)
        else:
            job_ref = db.collection("voiceJobs").document(job_id)
        
        job_doc = job_ref.get()
        if not job_doc.exists:
            raise Exception(f"Job {job_id} not found")
        
        job_data = job_doc.to_dict()
        if not job_data:
            raise Exception(f"Job {job_id} is empty")
            
        speaker_samples = job_data.get("speakerVoiceSamples", {})
        sample_url = speaker_samples.get(speaker_id)
        
        if not sample_url:
            raise Exception(f"No sample found for speaker {speaker_id}")
        
        # Download from URL
        if sample_url.startswith("gs://"):
            path_parts = sample_url.replace("gs://", "").split("/", 1)
            bucket_name = path_parts[0]
            blob_path = path_parts[1]
            
            bucket = storage.bucket(bucket_name)
            blob = bucket.blob(blob_path)
            return blob.download_as_bytes()
        
        elif sample_url.startswith("http"):
            response = requests.get(sample_url, timeout=30)
            if response.status_code == 200:
                return response.content
        
        raise Exception(f"Invalid sample URL format: {sample_url}")
        
    except Exception as e:
        logger.error(f"Failed to download original speaker sample: {str(e)}")
        raise


def fetch_voice_samples_from_character_ids(
    character_ids: list[str],
    job_id: Optional[str] = None,
    job_type: str = "voice"
) -> list[bytes]:
    """Download voice samples from Firebase based on character IDs."""
    voice_samples = []
    
    for char_id in character_ids:
        if char_id is None:
            logger.warning("Skipping None character ID")
            continue
        
        try:
            if isinstance(char_id, str) and char_id.startswith("original:"):
                speaker_id = char_id.split(":", 1)[1]
                audio_bytes = download_original_speaker_sample(job_id, speaker_id, job_type)
                voice_samples.append(audio_bytes)
            else:
                audio_bytes = download_voice_sample_from_firebase(char_id)
                voice_samples.append(audio_bytes)
        
        except Exception as e:
            logger.error(f"Failed to download sample for {char_id}: {str(e)}")
            raise Exception(f"Failed to load voice sample: {str(e)}")
    
    return voice_samples


def update_job_retry_status(
    job_ref,
    retry_count: int,
    error_message: str,
    is_final: bool
):
    """Update job document with retry information."""
    if is_final:
        job_ref.update({
            "status": "failed",
            "error": error_message,
            "retryCount": retry_count,
            "retriesExhausted": True,
            "updatedAt": SERVER_TIMESTAMP
        })
    else:
        job_ref.update({
            "status": "retrying",
            "lastError": error_message,
            "retryCount": retry_count,
            "maxRetries": MAX_RETRY_ATTEMPTS,
            "nextRetryAttempt": retry_count + 1,
            "updatedAt": SERVER_TIMESTAMP
        })


def inference_route(processor, model):
    """
    Unified inference endpoint with retry handling.
    """
    # Get retry information
    retry_count, is_retry, is_final_attempt = get_retry_info_from_headers(request.headers)
    
    if is_retry:
        logger.info(f"Retry attempt {retry_count}/{MAX_RETRY_ATTEMPTS}")
    
    # Validate request
    try:
        req = validate_request(InferenceRequest, request.get_json(silent=True) or {})
    except ValidationError as e:
        logger.warning(f"Invalid request: {e.errors()}")
        return jsonify({"error": "Invalid request", "details": e.errors()}), 400
    
    job_id = req.job_id
    uid = req.uid
    chunk_id = req.chunk_id
    
    g.job_id = job_id
    is_multi_chunk = chunk_id is not None
    
    if is_multi_chunk:
        logger.info(f"Processing chunk {chunk_id+1} for job {job_id} (retry {retry_count})")
    
    start_time = time.time()
    reserved_cost = 0
    
    try:
        # Get job
        job_ref = db.collection("voiceJobs").document(job_id)
        job_doc = job_ref.get()
        job_type = "voice"
        
        if not job_doc.exists:
            job_ref = db.collection("dubbingJobs").document(job_id)
            job_doc = job_ref.get()
            job_type = "dubbing"
        
        if not job_doc.exists:
            logger.error(f"Job {job_id} not found")
            return jsonify({"error": "Job not found"}), 404
        
        job_data = job_doc.to_dict()
        if not job_data or job_data.get("uid") != uid:
            logger.error(f"Unauthorized or invalid job {job_id}")
            return jsonify({"error": "Unauthorized"}), 403
        
        logger.info(f"Processing {job_type} job {job_id}")
        
        # Get text and character IDs
        if job_type == "voice":
            if is_multi_chunk:
                chunks = job_data.get("chunks", [])
                if chunk_id >= len(chunks):
                    return jsonify({"error": "Chunk not found"}), 404
                
                chunk_data = chunks[chunk_id]
                text = chunk_data.get("text")
                character_ids = chunk_data.get("characterIds", [])
                total_chunks = len(chunks)
            else:
                text = job_data.get("text")
                character_ids = job_data.get("characterIds", [])
                total_chunks = 1
            
            reserved_cost = job_data.get("cost", 0)
        
        else:  # dubbing job
            cloned_chunks = job_data.get("clonedAudioChunks", [])
            chunk_data = None
            for chunk in cloned_chunks:
                if chunk["chunkId"] == chunk_id:
                    chunk_data = chunk
                    break
            
            if not chunk_data:
                return jsonify({"error": "Chunk not found"}), 404
            
            text = chunk_data.get("text")
            character_ids = chunk_data.get("characterIds", [])
            total_chunks = len(cloned_chunks)
        
        if not text:
            return jsonify({"error": "No text in job"}), 400
        
        if not character_ids:
            return jsonify({"error": "No character IDs in job"}), 400
        
        logger.info(f"Job {job_id}: Downloading {len(character_ids)} voice samples")
        
        # Download voice samples
        try:
            voice_samples_bytes = fetch_voice_samples_from_character_ids(
                character_ids,
                job_id,
                job_type
            )
        except Exception as e:
            error_msg = f"Failed to load voice samples: {str(e)}"
            logger.error(error_msg)
            
            if is_final_attempt:
                update_job_status(job_id, "failed", error=error_msg)
                release_credits(uid, job_id, reserved_cost)
                return jsonify({"error": error_msg}), 500
            else:
                update_job_retry_status(job_ref, retry_count, error_msg, False)
                return jsonify({"error": "Retrying", "retry": retry_count}), 500
        
        logger.info(f"Job {job_id}: Successfully downloaded {len(voice_samples_bytes)} samples")
        
        # Update job status
        if job_type == "voice":
            if is_multi_chunk:
                chunks = job_data.get("chunks", [])
                if chunk_id < len(chunks):
                    chunks[chunk_id]["status"] = "processing"
                    if is_retry:
                        chunks[chunk_id]["retryCount"] = retry_count
                    job_ref.update({"chunks": chunks, "status": "processing"})
            else:
                update_data = {"status": "processing"}
                if is_retry:
                    update_data["retryCount"] = retry_count
                job_ref.update(update_data)
        else:
            cloned_chunks = job_data.get("clonedAudioChunks", [])
            for chunk in cloned_chunks:
                if chunk["chunkId"] == chunk_id:
                    chunk["status"] = "processing"
                    if is_retry:
                        chunk["retryCount"] = retry_count
            job_ref.update({
                "clonedAudioChunks": cloned_chunks,
                "updatedAt": SERVER_TIMESTAMP
            })
        
        # Format text
        final_text = text
        is_multi_character = detect_multi_speaker(text)
        
        if not is_multi_character:
            final_text = format_text_for_vibevoice(text)
        
        # Map voice samples
        voice_samples = map_speakers_to_voice_samples(final_text, voice_samples_bytes)
        
        # Run inference
        inputs = processor(
            text=[final_text],
            voice_samples=voice_samples,
            return_tensors="pt",
            padding=True,
        ).to(config.DEVICE)
        
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=None,
                cfg_scale=1.3,
                tokenizer=processor.tokenizer,
                generation_config={'do_sample': False},
                verbose=False,
            )
            # Extract and convert audio
            audio_np = generated.speech_outputs[0].cpu().to(torch.float32).numpy().squeeze()
        
        # Post-process
        audio_np = np.clip(audio_np, -1.0, 1.0)
        if np.abs(audio_np).max() > 0:
            audio_np = audio_np / np.abs(audio_np).max() * config.NORMALIZATION_HEADROOM
        
        audio_duration = len(audio_np) / config.SAMPLE_RATE
        inference_time = time.time() - start_time
        
        # Save to buffer
        buffer = BytesIO()
        sf.write(buffer, audio_np, config.SAMPLE_RATE, format="WAV")
        audio_bytes = buffer.getvalue()
        
        # Upload to GCS
        if job_type == "dubbing":
            gcs_bucket = config.GCS_DUBBING_BUCKET
            blob_name = f"jobs/{job_id}/chunks/chunk_{chunk_id}.wav"
        else:
            gcs_bucket = config.GCS_BUCKET
            if is_multi_chunk:
                blob_name = f"jobs/{job_id}/chunk_{chunk_id}.wav"
            else:
                blob_name = f"jobs/{job_id}/output.wav"
        
        upload_to_gcs(gcs_bucket, blob_name, audio_bytes, content_type="audio/wav")
        chunk_url = f"gs://{gcs_bucket}/{blob_name}"
        
        logger.info(f"Job {job_id}: Generated {audio_duration:.2f}s in {inference_time:.2f}s (retry {retry_count})")
        
        # Handle completion
        if is_multi_chunk:
            return _handle_multi_chunk_completion(
                job_ref,
                job_id,
                uid,
                chunk_id,
                total_chunks,
                chunk_url,
                audio_duration,
                reserved_cost,
                is_multi_character,
                job_type
            )
        else:
            return _handle_single_chunk_completion(
                job_ref,
                job_id,
                uid,
                blob_name,
                audio_bytes,
                audio_duration,
                inference_time,
                reserved_cost,
                is_multi_character
            )
    
    except torch.cuda.OutOfMemoryError:
        error_msg = "Out of memory"
        logger.error(f"GPU OOM (attempt {retry_count + 1})", exc_info=True)
        
        # Clear CUDA cache for retry
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        if is_final_attempt:
            update_job_status(job_id, "failed", error=error_msg)
            release_credits(uid, job_id, reserved_cost)
            return jsonify({"error": "GPU OOM after retries"}), 503
        else:
            update_job_retry_status(job_ref, retry_count, error_msg, False)
            return jsonify({"error": "Retrying", "retry": retry_count}), 503
    
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Inference failed (attempt {retry_count + 1}): {error_msg}", exc_info=True)
        
        if is_final_attempt:
            update_job_status(job_id, "failed", error=error_msg)
            release_credits(uid, job_id, reserved_cost)
            return jsonify({"error": "Internal error after retries"}), 500
        else:
            update_job_retry_status(job_ref, retry_count, error_msg, False)
            return jsonify({"error": "Retrying", "retry": retry_count}), 500


def _handle_multi_chunk_completion(
    job_ref,
    job_id: str,
    uid: str,
    chunk_id: int,
    total_chunks: int,
    chunk_url: str,
    audio_duration: float,
    reserved_cost: int,
    is_multi_character: bool,
    job_type: str = "voice"
):
    """Handle completion of multi-chunk job."""
    job_doc = job_ref.get()
    job_data = job_doc.to_dict()
    
    if job_type == "voice":
        chunks = job_data.get("chunks", [])
        if chunk_id < len(chunks):
            chunks[chunk_id]["status"] = "completed"
            chunks[chunk_id]["audioUrl"] = chunk_url
            chunks[chunk_id]["duration"] = audio_duration
        
        completed_chunks = sum(1 for c in chunks if c.get("status") == "completed")
        job_ref.update({"chunks": chunks, "completedChunks": completed_chunks})
        chunk_urls = [c["audioUrl"] for c in chunks if c.get("audioUrl")]
        gcs_bucket = config.GCS_BUCKET
        
    else:  # dubbing
        cloned_chunks = job_data.get("clonedAudioChunks", [])
        for chunk in cloned_chunks:
            if chunk["chunkId"] == chunk_id:
                chunk["status"] = "completed"
                chunk["audioUrl"] = chunk_url
                chunk["duration"] = audio_duration
                break
        
        completed_chunks = sum(1 for c in cloned_chunks if c.get("status") == "completed")
        job_ref.update({
            "clonedAudioChunks": cloned_chunks,
            "completedChunks": completed_chunks,
            "updatedAt": SERVER_TIMESTAMP
        })
        chunk_urls = [c["audioUrl"] for c in cloned_chunks if c.get("audioUrl")]
        gcs_bucket = config.GCS_DUBBING_BUCKET
    
    logger.info(f"Job {job_id}: Completed {completed_chunks}/{total_chunks} chunks")
    
    # Merge if all done
    if completed_chunks == total_chunks:
        logger.info(f"Job {job_id}: All chunks complete, merging...")
        
        merged_audio = merge_audio_chunks_from_gcs(gcs_bucket, chunk_urls)
        merged_blob_name = f"jobs/{job_id}/output.wav"
        upload_to_gcs(gcs_bucket, merged_blob_name, merged_audio.getvalue(), content_type="audio/wav")
        
        signed_url = generate_signed_url(gcs_bucket, merged_blob_name, 24)
        
        if job_type == "voice":
            total_duration = sum(c.get("duration", 0) for c in chunks)
        else:
            total_duration = sum(c.get("duration", 0) for c in cloned_chunks)
        
        actual_cost = calculate_cost_from_duration(total_duration, is_multi_character)
        confirm_credit_deduction(uid, job_id, actual_cost)
        
        job_ref.update({
            "status": "completed",
            "audioUrl": signed_url,
            "duration": total_duration,
            "actualCost": actual_cost,
            "reservedCost": reserved_cost,
            "creditRefund": max(0, reserved_cost - actual_cost),
            "updatedAt": SERVER_TIMESTAMP
        })
        
        logger.info(f"Job {job_id}: Completed with merged audio")
    
    return jsonify({
        "status": "chunk_completed",
        "chunk_id": chunk_id,
        "completed_chunks": completed_chunks,
        "total_chunks": total_chunks
    }), 200


def _handle_single_chunk_completion(
    job_ref,
    job_id: str,
    uid: str,
    blob_name: str,
    audio_bytes: bytes,
    audio_duration: float,
    inference_time: float,
    reserved_cost: int,
    is_multi_character: bool
):
    """Handle single chunk completion."""
    actual_cost = calculate_cost_from_duration(audio_duration, is_multi_character)
    confirm_credit_deduction(uid, job_id, actual_cost)
    
    signed_url = generate_signed_url(config.GCS_BUCKET, blob_name, 24)
    
    job_ref.update({
        "status": "completed",
        "audioUrl": signed_url,
        "audioSize": len(audio_bytes),
        "duration": audio_duration,
        "inferenceTimeSeconds": inference_time,
        "actualCost": actual_cost,
        "reservedCost": reserved_cost,
        "creditRefund": max(0, reserved_cost - actual_cost),
        "updatedAt": SERVER_TIMESTAMP
    })
    
    logger.info(f"Job {job_id}: Completed")
    
    return jsonify({
        "status": "completed",
        "audio_url": signed_url,
        "duration": audio_duration,
        "actual_cost": actual_cost
    }), 200