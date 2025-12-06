# functions/inference/main.py
from flask import Flask, request, abort, jsonify
import os
import logging
import torch
from pathlib import Path
from io import BytesIO
import soundfile as sf
import numpy as np
from datetime import datetime, timedelta
from google.cloud import storage
from firebase_admin import credentials, firestore, initialize_app

from utils import (
    b64_to_voice_sample,
    detect_multi_speaker,
    format_text_for_vibevoice,
    map_speakers_to_voice_samples,
    log_startup_info,
    get_optimal_attention_mode,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Initialize Firebase Admin
if not len(credentials.Certificate._from_dict):
    cred = credentials.ApplicationDefault()
    initialize_app(cred)

db = firestore.client()

# Config
device = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
MODEL_DIR = Path("/app/models/VibeVoice-1.5B")  # Baked into Docker image
SAMPLE_RATE = 24000
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")
GCS_BUCKET = os.getenv("GCS_BUCKET", "fennai-voice-output")

processor = None
model = None
storage_client = storage.Client()
bucket = storage_client.bucket(GCS_BUCKET)


def ensure_model_loaded():
    """Load model on first request (lazy loading)"""
    global processor, model
    if model is not None:
        return

    logger.info("Loading VibeVoice model...")
    from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor
    from vibevoice.modular.modeling_vibevoice_inference import VibeVoiceForConditionalGenerationInference

    if not MODEL_DIR.exists():
        logger.error(f"Model not found at {MODEL_DIR}")
        raise RuntimeError(f"Model not found. Expected at {MODEL_DIR}")

    logger.info(f"Loading model from {MODEL_DIR}")

    processor = VibeVoiceProcessor.from_pretrained(str(MODEL_DIR))
    dtype = torch.float16 if device == "cuda" else torch.float32
    model = VibeVoiceForConditionalGenerationInference.from_pretrained(
        str(MODEL_DIR),
        torch_dtype=dtype,
    )

    # Attention mode
    attn_mode = get_optimal_attention_mode()
    if hasattr(model.config, "attention_type"):
        model.config.attention_type = attn_mode

    model.to(device)
    model.eval()
    model.set_ddpm_inference_steps(10)

    log_startup_info()
    logger.info("Model loaded and ready!")


def update_job_status(job_id: str, status: str, **kwargs):
    """Update job document in Firestore"""
    try:
        job_ref = db.collection("voiceJobs").document(job_id)
        updates = {
            "status": status,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        updates.update(kwargs)
        job_ref.update(updates)
        logger.info(f"Job {job_id} status updated to {status}")
    except Exception as e:
        logger.error(f"Failed to update job {job_id}: {str(e)}")


def upload_to_gcs_with_signed_url(job_id: str, audio_bytes: bytes) -> str:
    """
    Upload audio to GCS and return signed URL.
    Bucket has 24-hour lifecycle policy for auto-deletion.
    """
    try:
        blob_name = f"jobs/{job_id}/output.wav"
        blob = bucket.blob(blob_name)
        
        # Upload audio
        blob.upload_from_string(
            audio_bytes,
            content_type="audio/wav"
        )
        
        # Generate signed URL (expires in 24 hours)
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(hours=24),
            method="GET"
        )
        
        logger.info(f"Audio uploaded to gs://{GCS_BUCKET}/{blob_name}")
        return signed_url
        
    except Exception as e:
        logger.error(f"Failed to upload to GCS: {str(e)}")
        raise


def release_credits_on_failure(uid: str, job_id: str, cost: int):
    """Helper to release credits when generation fails"""
    try:
        user_ref = db.collection("users").document(uid)
        
        @firestore.transactional
        def decrement_pending(transaction):
            user_doc = transaction.get(user_ref)
            if user_doc.exists:
                user_data = user_doc.to_dict() or {}
                if not user_data.get("isPro", False):
                    transaction.update(user_ref, {
                        "pendingCredits": firestore.Increment(-cost)
                    })
        
        transaction = db.transaction()
        decrement_pending(transaction)
        logger.info(f"Released {cost} credits for user {uid}")
        
    except Exception as e:
        logger.error(f"Failed to release credits: {str(e)}")


def confirm_credit_deduction_internal(uid: str, job_id: str, cost: int):
    """Helper to confirm credit deduction after successful generation"""
    try:
        user_ref = db.collection("users").document(uid)
        
        @firestore.transactional
        def finalize_credits(transaction):
            user_doc = transaction.get(user_ref)
            if user_doc.exists:
                user_data = user_doc.to_dict() or {}
                is_pro = user_data.get("isPro", False)
                
                updates = {
                    "totalVoicesGenerated": firestore.Increment(1),
                    "updatedAt": firestore.SERVER_TIMESTAMP
                }
                
                if not is_pro:
                    updates["credits"] = firestore.Increment(-cost)
                    updates["pendingCredits"] = firestore.Increment(-cost)
                
                transaction.update(user_ref, updates)
        
        transaction = db.transaction()
        finalize_credits(transaction)
        logger.info(f"Deducted {cost} credits from user {uid}")
        
    except Exception as e:
        logger.error(f"Failed to deduct credits: {str(e)}")


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint"""
    is_loaded = model is not None
    
    return jsonify({
        "status": "healthy",
        "model_loaded": is_loaded,
        "model_name": MODEL_NAME,
        "device": device,
    }), 200


@app.route("/inference", methods=["POST"])
def inference():
    """
    Main inference endpoint called by Cloud Tasks.
    
    Flow:
    1. Verify internal token
    2. Update job status to 'processing'
    3. Load model if needed
    4. Generate audio
    5. Upload to GCS with signed URL
    6. Confirm credit deduction
    7. Update job status to 'completed'
    
    Error handling:
    - 400: Bad input (won't retry)
    - 500: Internal error (will retry)
    - 503: OOM/resource error (will retry)
    """
    
    # Verify internal token
    token = request.headers.get("X-Internal-Token")
    if token != INTERNAL_TOKEN:
        logger.warn("Unauthorized inference request")
        abort(403, "Forbidden")

    data = request.get_json() or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    cost = data.get("cost", 1)
    raw_text = data.get("text", "").strip()
    voice_b64s = data.get("voice_samples", [])

    # Validate required fields
    if not job_id or not uid:
        logger.error("Missing job_id or uid")
        abort(400, "Missing job_id or uid")
    
    if not raw_text or not voice_b64s:
        logger.error(f"Job {job_id}: Missing text or voice_samples")
        update_job_status(job_id, "failed", error="Missing text or voice_samples")
        release_credits_on_failure(uid, job_id, cost)
        abort(400, "Missing text or voice_samples")

    logger.info(f"Processing job {job_id} for user {uid}")

    try:
        # Update status to processing
        update_job_status(job_id, "processing")
        
        # Load model if not loaded
        ensure_model_loaded()
        
        # Format text
        text_to_use = raw_text.strip()
        if not detect_multi_speaker(text_to_use):
            text_to_use = format_text_for_vibevoice(raw_text)

        logger.info(f"Job {job_id}: Using text:\n{text_to_use}")

        # Prepare voice samples
        voice_samples = map_speakers_to_voice_samples(text_to_use, voice_b64s)

        # Run inference
        inputs = processor(
            text=[text_to_use],
            voice_samples=voice_samples,
            return_tensors="pt",
            padding=True,
        ).to(device)

        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                do_sample=False,
                cfg_scale=1.3,
            )

        audio = processor.decode(generated, skip_special_tokens=True)
        audio_np = audio.cpu().numpy().squeeze()

        # Post-process audio
        audio_np = np.clip(audio_np, -1.0, 1.0)
        if np.abs(audio_np).max() > 0:
            audio_np = audio_np / np.abs(audio_np).max() * 0.95

        # Convert to WAV bytes
        buffer = BytesIO()
        sf.write(buffer, audio_np, SAMPLE_RATE, format="WAV")
        audio_bytes = buffer.getvalue()

        logger.info(f"Job {job_id}: Audio generated successfully ({len(audio_bytes)} bytes)")

        # Upload to GCS
        signed_url = upload_to_gcs_with_signed_url(job_id, audio_bytes)
        
        # Confirm credit deduction
        confirm_credit_deduction_internal(uid, job_id, cost)
        
        # Update job as completed
        expires_at = datetime.utcnow() + timedelta(hours=24)
        update_job_status(
            job_id, 
            "completed", 
            audioUrl=signed_url,
            expiresAt=expires_at,
            audioSize=len(audio_bytes)
        )
        
        logger.info(f"Job {job_id} completed successfully")
        
        return jsonify({
            "status": "completed",
            "job_id": job_id,
            "audio_url": signed_url
        }), 200

    except torch.cuda.OutOfMemoryError as e:
        logger.error(f"Job {job_id}: GPU OOM - {str(e)}")
        update_job_status(job_id, "failed", error="GPU out of memory")
        release_credits_on_failure(uid, job_id, cost)
        
        # Return 503 to trigger retry by Cloud Tasks
        return jsonify({"error": "GPU out of memory"}), 503

    except ValueError as e:
        # Bad input - don't retry
        logger.error(f"Job {job_id}: Validation error - {str(e)}")
        update_job_status(job_id, "failed", error=str(e))
        release_credits_on_failure(uid, job_id, cost)
        
        # Return 400 - won't retry
        return jsonify({"error": str(e)}), 400

    except Exception as e:
        # Unknown error - retry with caution
        logger.error(f"Job {job_id}: Unexpected error - {str(e)}", exc_info=True)
        update_job_status(job_id, "failed", error="Internal error")
        release_credits_on_failure(uid, job_id, cost)
        
        # Return 500 - will retry
        return jsonify({"error": "Internal error"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)