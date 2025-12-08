# functions/inference/main.py
import os
import logging
import torch
import numpy as np
import time
from datetime import datetime, timedelta
from pathlib import Path
from io import BytesIO

from flask import Flask, request, abort, jsonify
import soundfile as sf
from pydub import AudioSegment

# === Google Cloud clients ===
from shared.firebase import db
from firebase_admin import firestore
from google.cloud import storage

# Enable maximum performance
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

# === Logging ===
class JobContextFilter(logging.Filter):
    def filter(self, record):
        record.job_id = getattr(request, "job_id", "NO_JOB")
        return True

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(job_id)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger(__name__)
logger.addFilter(JobContextFilter())

app = Flask(__name__)

# === Config ===
device = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
MODEL_DIR = Path("/app/models/VibeVoice-1.5B")
SAMPLE_RATE = 24000
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")
GCS_BUCKET = os.getenv("GCS_BUCKET", "fennai-voice-output")

storage_client = storage.Client()

# Model globals
processor = None
model = None
START_TIME = datetime.utcnow()

# === Utils ===
from utils import (
    b64_to_voice_sample,
    detect_multi_speaker,
    format_text_for_vibevoice,
    map_speakers_to_voice_samples,
    log_startup_info,
    get_optimal_attention_mode,
)

# === Load model ===
def load_model():
    global processor, model
    logger.info("Loading VibeVoice-1.5B...")
    
    if not MODEL_DIR.exists():
        raise RuntimeError(f"Model directory not found: {MODEL_DIR}")
    
    try:
        from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor
        from vibevoice.modular.modeling_vibevoice_inference import VibeVoiceForConditionalGenerationInference
        
        processor = VibeVoiceProcessor.from_pretrained(str(MODEL_DIR))
        
        dtype = torch.float16 if device == "cuda" else torch.float32
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(
            str(MODEL_DIR),
            torch_dtype=dtype,
        )
        
        model.to(device)
        model.eval()
        model.set_ddpm_inference_steps(10)
        
        attn_mode = get_optimal_attention_mode()
        if hasattr(model.config, "attention_type"):
            model.config.attention_type = attn_mode
        
        if device == "cuda":
            model = torch.compile(model, mode="reduce-overhead", fullgraph=True)
        
        log_startup_info()
        logger.info(f"Model ready! GPU memory: {torch.cuda.memory_allocated()/1e9:.2f} GB")
        
    except Exception as e:
        logger.error("Failed to load model", exc_info=True)
        raise

load_model()

# === Import route handlers ===
from routes.extract_audio import extract_audio_route
from routes.cluster_speakers import cluster_speakers_route
from routes.clone_audio import clone_audio_route
from routes.merge_audio import merge_audio_route
from routes.merge_video import merge_video_route

# === Helper functions ===
def calculate_actual_cost(duration_seconds: float, is_multi_character: bool = False) -> int:
    """Smart credit calculation based on actual audio duration"""
    base_credits = max(1, int(np.ceil(duration_seconds / 10.0)))
    if is_multi_character:
        base_credits = int(np.ceil(base_credits * 1.2))
    return max(1, base_credits)

def update_job_with_actual_cost(job_id: str, uid: str, reserved_cost: int, actual_cost: int):
    """Update job and adjust credits based on actual usage"""
    try:
        user_ref = db.collection("users").document(uid)
        job_ref = db.collection("voiceJobs").document(job_id)
        
        @firestore.transactional
        def update_in_transaction(transaction):
            user_doc = transaction.get(user_ref)
            if not user_doc.exists:
                return
            
            user_data = user_doc.to_dict()
            is_pro = user_data.get("isPro", False)
            credit_difference = reserved_cost - actual_cost
            
            updates = {
                "totalVoicesGenerated": firestore.Increment(1),
                "updatedAt": firestore.SERVER_TIMESTAMP
            }
            
            if not is_pro:
                updates["credits"] = firestore.Increment(-actual_cost)
                updates["pendingCredits"] = firestore.Increment(-reserved_cost)
            
            transaction.update(user_ref, updates)
            transaction.update(job_ref, {
                "actualCost": actual_cost,
                "reservedCost": reserved_cost,
                "creditRefund": credit_difference if credit_difference > 0 else 0
            })
        
        transaction = db.transaction()
        update_in_transaction(transaction)
        
        if reserved_cost != actual_cost:
            logger.info(f"Job {job_id}: Reserved {reserved_cost}, used {actual_cost}, refunded {reserved_cost - actual_cost}")
            
    except Exception as e:
        logger.error(f"Failed to update actual cost: {str(e)}")

def release_credits_on_failure(job_id: str, uid: str, cost: int):
    """Release all reserved credits when job fails"""
    try:
        user_ref = db.collection("users").document(uid)
        
        @firestore.transactional
        def release_in_transaction(transaction):
            user_doc = transaction.get(user_ref)
            if not user_doc.exists:
                return
            
            user_data = user_doc.to_dict()
            is_pro = user_data.get("isPro", False)
            
            if not is_pro:
                transaction.update(user_ref, {
                    "pendingCredits": firestore.Increment(-cost),
                    "updatedAt": firestore.SERVER_TIMESTAMP
                })
        
        transaction = db.transaction()
        release_in_transaction(transaction)
        logger.info(f"Released {cost} credits for failed job {job_id}")
        
    except Exception as e:
        logger.error(f"Failed to release credits: {str(e)}")

def merge_audio_chunks_from_gcs(job_id: str, chunk_urls: list) -> BytesIO:
    """Download and merge multiple audio chunks"""
    bucket = storage_client.bucket(GCS_BUCKET)
    merged = None
    
    for i, url in enumerate(chunk_urls):
        # Extract blob path from URL
        blob_path = url.replace(f"gs://{GCS_BUCKET}/", "")
        blob = bucket.blob(blob_path)
        
        # Download chunk
        audio_bytes = blob.download_as_bytes()
        chunk_audio = AudioSegment.from_wav(BytesIO(audio_bytes))
        
        if merged is None:
            merged = chunk_audio
        else:
            merged += chunk_audio
        
        logger.info(f"Job {job_id}: Merged chunk {i+1}/{len(chunk_urls)}")
    
    # Export to BytesIO
    output = BytesIO()
    merged.export(output, format="wav")
    output.seek(0)
    return output

# === Routes ===
@app.before_request
def block_large_requests():
    if request.content_length and request.content_length > 10 * 1024 * 1024:
        abort(413, "Payload too large")

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "model_loaded": True,
        "device": device,
        "gpu_memory_gb": round(torch.cuda.memory_allocated() / 1e9, 2) if device == "cuda" else None,
        "uptime_seconds": round((datetime.utcnow() - START_TIME).total_seconds(), 1),
        "model": MODEL_NAME,
    }), 200

@app.route("/extract-audio", methods=["POST"])
def extract_audio():
    return extract_audio_route(request)

@app.route("/cluster-speakers", methods=["POST"])
def cluster_speakers():
    return cluster_speakers_route(request)

@app.route("/clone-audio", methods=["POST"])
def clone_audio():
    return clone_audio_route(request)

@app.route("/merge-audio", methods=["POST"])
def merge_audio():
    return merge_audio_route(request)

@app.route("/merge-video", methods=["POST"])
def merge_video():
    return merge_video_route(request)

@app.route("/inference", methods=["POST"])
def inference():
    """
    ENHANCED with multi-chunk support for unlimited speakers
    Handles both single-chunk (≤4 speakers) and multi-chunk (>4 speakers)
    """
    request.job_id = "NO_JOB"
    
    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        abort(403)
    
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    reserved_cost = int(data.get("cost", 1))
    text = data.get("text", "").strip()
    voice_samples_b64 = data.get("voice_samples", [])
    chunk_id = data.get("chunk_id")  # None for single chunk
    total_chunks = data.get("total_chunks", 1)
    
    if not all([job_id, uid, text, voice_samples_b64]):
        abort(400, "Missing required fields")
    
    request.job_id = job_id
    is_multi_chunk = chunk_id is not None
    
    if is_multi_chunk:
        logger.info(f"Processing chunk {chunk_id+1}/{total_chunks}")
    
    start_time = time.time()
    
    try:
        job_ref = db.collection("voiceJobs").document(job_id)
        
        if is_multi_chunk:
            # Update chunk status
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
            job_ref.update({"status": "processing"})
        
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
        ).to(device)
        
        with torch.inference_mode():
            generated = model.generate(**inputs, do_sample=False, cfg_scale=1.3)
            audio = processor.decode(generated, skip_special_tokens=True)
        
        # Post-process
        audio_np = audio.cpu().numpy().squeeze()
        audio_np = np.clip(audio_np, -1.0, 1.0)
        if np.abs(audio_np).max() > 0:
            audio_np = audio_np / np.abs(audio_np).max() * 0.95
        
        audio_duration = len(audio_np) / SAMPLE_RATE
        inference_time = time.time() - start_time
        
        # Save audio
        buffer = BytesIO()
        sf.write(buffer, audio_np, SAMPLE_RATE, format="WAV")
        audio_bytes = buffer.getvalue()
        
        # Upload to GCS
        bucket = storage_client.bucket(GCS_BUCKET)
        
        if is_multi_chunk:
            blob_name = f"jobs/{job_id}/chunk_{chunk_id}.wav"
        else:
            blob_name = f"jobs/{job_id}/output.wav"
        
        blob = bucket.blob(blob_name)
        blob.upload_from_string(audio_bytes, content_type="audio/wav")
        chunk_url = f"gs://{GCS_BUCKET}/{blob_name}"
        
        logger.info(f"Job {job_id}: Generated {audio_duration:.2f}s in {inference_time:.2f}s")
        
        # Handle multi-chunk completion
        if is_multi_chunk:
            # Update chunk status
            job_doc = job_ref.get()
            job_data = job_doc.to_dict()
            chunks = job_data.get("chunks", [])
            
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
                merged_audio = merge_audio_chunks_from_gcs(job_id, chunk_urls)
                
                # Upload merged audio
                merged_blob_name = f"jobs/{job_id}/output.wav"
                merged_blob = bucket.blob(merged_blob_name)
                merged_blob.upload_from_file(merged_audio, content_type="audio/wav")
                
                signed_url = merged_blob.generate_signed_url(
                    version="v4",
                    expiration=timedelta(hours=24),
                    method="GET",
                )
                
                # Calculate total duration
                total_duration = sum(c.get("duration", 0) for c in chunks)
                actual_cost = calculate_actual_cost(total_duration, is_multi_character)
                
                # Update credits
                update_job_with_actual_cost(job_id, uid, reserved_cost, actual_cost)
                
                # Mark job complete
                job_ref.update({
                    "status": "completed",
                    "audioUrl": signed_url,
                    "expiresAt": datetime.utcnow() + timedelta(hours=24),
                    "duration": total_duration,
                    "actualCost": actual_cost,
                    "updatedAt": firestore.SERVER_TIMESTAMP
                })
                
                logger.info(f"Job {job_id}: Completed with merged audio")
            
            return jsonify({
                "status": "chunk_completed",
                "chunk_id": chunk_id,
                "completed_chunks": completed_chunks,
                "total_chunks": total_chunks
            }), 200
        
        else:
            # Single chunk - mark as complete immediately
            actual_cost = calculate_actual_cost(audio_duration, is_multi_character)
            update_job_with_actual_cost(job_id, uid, reserved_cost, actual_cost)
            
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(hours=24),
                method="GET",
            )
            
            job_ref.update({
                "status": "completed",
                "audioUrl": signed_url,
                "expiresAt": datetime.utcnow() + timedelta(hours=24),
                "audioSize": len(audio_bytes),
                "duration": audio_duration,
                "inferenceTimeSeconds": inference_time,
                "actualCost": actual_cost,
                "updatedAt": firestore.SERVER_TIMESTAMP
            })
            
            logger.info(f"Job {job_id}: Completed")
            
            return jsonify({
                "status": "completed",
                "audio_url": signed_url,
                "duration": audio_duration,
                "actual_cost": actual_cost
            }), 200
    
    except torch.cuda.OutOfMemoryError:
        logger.error(f"GPU OOM", exc_info=True)
        job_ref.update({"status": "failed", "error": "Out of memory"})
        release_credits_on_failure(job_id, uid, reserved_cost)
        return jsonify({"error": "GPU OOM"}), 503
    
    except Exception as e:
        logger.error(f"Inference failed: {str(e)}", exc_info=True)
        job_ref.update({"status": "failed", "error": str(e)})
        release_credits_on_failure(job_id, uid, reserved_cost)
        return jsonify({"error": "Internal error"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)