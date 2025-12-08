# functions/inference/routes/inference.py
"""
Main inference route for voice cloning.
Handles both single-chunk (≤4 speakers) and multi-chunk (>4 speakers) generation.
"""
import logging
import time
import torch
import numpy as np
from io import BytesIO

import soundfile as sf
from flask import request, jsonify
from firebase_admin import firestore
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


def inference_route(processor, model):
    """
    Main inference endpoint with multi-chunk support.
    
    Args:
        processor: VibeVoice processor instance (injected from main.py)
        model: VibeVoice model instance (injected from main.py)
    
    Returns:
        Tuple of (response_dict, status_code)
    """
    # Validate request
    try:
        req = validate_request(InferenceRequest, request.get_json(silent=True) or {})
    except ValidationError as e:
        logger.warning(f"Invalid request: {e.errors()}")
        return jsonify({"error": "Invalid request", "details": e.errors()}), 400
    
    job_id = req.job_id
    uid = req.uid
    reserved_cost = req.cost
    text = req.text
    voice_samples_b64 = req.voice_samples
    chunk_id = req.chunk_id
    total_chunks = req.total_chunks
    
    request.job_id = job_id
    is_multi_chunk = chunk_id is not None
    
    if is_multi_chunk:
        logger.info(f"Processing chunk {chunk_id+1}/{total_chunks}")
    
    start_time = time.time()
    
    try:
        job_ref = db.collection("voiceJobs").document(job_id)
        
        # Update status
        if is_multi_chunk:
            job_doc = job_ref.get()
            if job_doc.exists:
                job_data = job_doc.to_dict()
                chunks = job_data.get("chunks", [])
                if chunk_id < len(chunks):
                    chunks[chunk_id]["status"] = "processing"
                    job_ref.update({
                        "chunks": chunks,
                        "status": "processing"
                    })
        else:
            update_job_status(job_id, "processing")
        
        # Format text
        final_text = text
        is_multi_character = detect_multi_speaker(text)
        
        if not is_multi_character:
            final_text = format_text_for_vibevoice(text)
        
        voice_samples = map_speakers_to_voice_samples(final_text, voice_samples_b64)
        
        # Run inference
        inputs = processor(
            text=[final_text],
            voice_samples=voice_samples,
            return_tensors="pt",
            padding=True,
        ).to(config.DEVICE)
        
        with torch.inference_mode():
            generated = model.generate(**inputs, do_sample=False, cfg_scale=1.3)
            audio = processor.decode(generated, skip_special_tokens=True)
        
        # Post-process audio
        audio_np = audio.cpu().numpy().squeeze()
        audio_np = np.clip(audio_np, -1.0, 1.0)
        if np.abs(audio_np).max() > 0:
            audio_np = audio_np / np.abs(audio_np).max() * config.NORMALIZATION_HEADROOM
        
        audio_duration = len(audio_np) / config.SAMPLE_RATE
        inference_time = time.time() - start_time
        
        # Save audio to buffer
        buffer = BytesIO()
        sf.write(buffer, audio_np, config.SAMPLE_RATE, format="WAV")
        audio_bytes = buffer.getvalue()
        
        # Upload to GCS
        if is_multi_chunk:
            blob_name = f"jobs/{job_id}/chunk_{chunk_id}.wav"
        else:
            blob_name = f"jobs/{job_id}/output.wav"
        
        blob = upload_to_gcs(
            config.GCS_BUCKET,
            blob_name,
            audio_bytes,
            content_type="audio/wav"
        )
        
        chunk_url = f"gs://{config.GCS_BUCKET}/{blob_name}"
        
        logger.info(f"Job {job_id}: Generated {audio_duration:.2f}s in {inference_time:.2f}s")
        
        # Handle multi-chunk completion
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
                is_multi_character
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
        logger.error("GPU OOM", exc_info=True)
        update_job_status(job_id, "failed", error="Out of memory")
        release_credits(uid, job_id, reserved_cost)
        return jsonify({"error": "GPU OOM"}), 503
    
    except Exception as e:
        logger.error(f"Inference failed: {str(e)}", exc_info=True)
        update_job_status(job_id, "failed", error=str(e))
        release_credits(uid, job_id, reserved_cost)
        return jsonify({"error": "Internal error"}), 500


def _handle_multi_chunk_completion(
    job_ref,
    job_id: str,
    uid: str,
    chunk_id: int,
    total_chunks: int,
    chunk_url: str,
    audio_duration: float,
    reserved_cost: int,
    is_multi_character: bool
):
    """Handle completion of a single chunk in multi-chunk job"""
    job_doc = job_ref.get()
    job_data = job_doc.to_dict()
    chunks = job_data.get("chunks", [])
    
    # Update this chunk
    if chunk_id < len(chunks):
        chunks[chunk_id]["status"] = "completed"
        chunks[chunk_id]["audioUrl"] = chunk_url
        chunks[chunk_id]["duration"] = audio_duration
    
    completed_chunks = sum(1 for c in chunks if c.get("status") == "completed")
    
    job_ref.update({
        "chunks": chunks,
        "completedChunks": completed_chunks
    })
    
    logger.info(f"Job {job_id}: Completed {completed_chunks}/{total_chunks} chunks")
    
    # If all chunks done, merge them
    if completed_chunks == total_chunks:
        logger.info(f"Job {job_id}: All chunks complete, merging...")
        
        chunk_urls = [c["audioUrl"] for c in chunks if c.get("audioUrl")]
        merged_audio = merge_audio_chunks_from_gcs(config.GCS_BUCKET, chunk_urls)
        
        # Upload merged audio
        merged_blob_name = f"jobs/{job_id}/output.wav"
        merged_blob = upload_to_gcs(
            config.GCS_BUCKET,
            merged_blob_name,
            merged_audio.getvalue(),
            content_type="audio/wav"
        )
        
        signed_url = generate_signed_url(config.GCS_BUCKET, merged_blob_name, 24)
        
        # Calculate total duration and actual cost
        total_duration = sum(c.get("duration", 0) for c in chunks)
        actual_cost = calculate_cost_from_duration(total_duration, is_multi_character)
        
        # Update credits
        confirm_credit_deduction(uid, job_id, actual_cost)
        
        # Mark job complete
        job_ref.update({
            "status": "completed",
            "audioUrl": signed_url,
            "duration": total_duration,
            "actualCost": actual_cost,
            "reservedCost": reserved_cost,
            "creditRefund": max(0, reserved_cost - actual_cost),
            "updatedAt": firestore.SERVER_TIMESTAMP
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
    """Handle completion of single-chunk job"""
    # Calculate actual cost
    actual_cost = calculate_cost_from_duration(audio_duration, is_multi_character)
    confirm_credit_deduction(uid, job_id, actual_cost)
    
    # Generate signed URL
    signed_url = generate_signed_url(config.GCS_BUCKET, blob_name, 24)
    
    # Update job
    job_ref.update({
        "status": "completed",
        "audioUrl": signed_url,
        "audioSize": len(audio_bytes),
        "duration": audio_duration,
        "inferenceTimeSeconds": inference_time,
        "actualCost": actual_cost,
        "reservedCost": reserved_cost,
        "creditRefund": max(0, reserved_cost - actual_cost),
        "updatedAt": firestore.SERVER_TIMESTAMP
    })
    
    logger.info(f"Job {job_id}: Completed")
    
    return jsonify({
        "status": "completed",
        "audio_url": signed_url,
        "duration": audio_duration,
        "actual_cost": actual_cost
    }), 200