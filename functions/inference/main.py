# functions/inference/main.py
import os
import logging
import torch
import numpy as np
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

from flask import Flask, request, abort, jsonify
import soundfile as sf

# Google Cloud clients — use Application Default Credentials (no explicit init needed)
from google.cloud import storage
import firebase_admin
from firebase_admin import firestore

# Enable TF32 for ~15-25% speedup on NVIDIA L4/A100
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

# === Logging with job_id context ===
class JobContextFilter(logging.Filter):
    def filter(self, record):
        record.job_id = getattr(request, "job_id", "NO_JOB")
        return True

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(job_id)s | %(levelname)s | %(message)s")
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

# Global clients (automatically use Cloud Run service account)
storage_client = storage.Client()
bucket = storage_client.bucket(GCS_BUCKET)
db = firestore.client()

# Initialize Firebase Admin only once
if not firebase_admin._apps:
    firebase_admin.initialize_app()

# Global model variables
processor = None
model = None
START_TIME = datetime.utcnow()

# === Import utils only after logging is set up ===
from utils import (
    b64_to_voice_sample,
    detect_multi_speaker,
    format_text_for_vibevoice,
    map_speakers_to_voice_samples,
    log_startup_info,
    get_optimal_attention_mode,
)

# === Model loading at container startup (critical for performance!) ===
def load_model():
    global processor, model
    logger.info("Container starting — loading VibeVoice model into GPU memory...")

    if not MODEL_DIR.exists():
        logger.error(f"Model directory not found: {MODEL_DIR}")
        raise RuntimeError(f"Model not found at {MODEL_DIR}")

    try:
        from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor
        from vibevoice.modular.modeling_vibevoice_inference import VibeVoiceForConditionalGenerationInference

        logger.info(f"Loading processor and model from {MODEL_DIR}")
        processor = VibeVoiceProcessor.from_pretrained(str(MODEL_DIR))

        dtype = torch.float16 if device == "cuda" else torch.float32
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(
            str(MODEL_DIR),
            torch_dtype=dtype,
        )

        model.to(device)
        model.eval()
        model.set_ddpm_inference_steps(10)

        # Best attention mode
        attn_mode = get_optimal_attention_mode()
        if hasattr(model.config, "attention_type"):
            model.config.attention_type = attn_mode

        # torch.compile = 20–40% faster inference on L4
        if device == "cuda":
            logger.info("Compiling model with torch.compile() for maximum performance...")
            model = torch.compile(model, mode="reduce-overhead", fullgraph=True)

        log_startup_info()
        logger.info("Model loaded and compiled successfully!")
        logger.info(f"GPU memory allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")

    except Exception as e:
        logger.error("Failed to load model", exc_info=True)
        raise

# === Fire it up at import time ===
load_model()

# === Helper functions ===
def update_job_status(job_id: str, status: str, **kwargs):
    try:
        job_ref = db.collection("voiceJobs").document(job_id)
        updates = {"status": status, "updatedAt": firestore.SERVER_TIMESTAMP}
        updates.update(kwargs)
        job_ref.update(updates)
    except Exception as e:
        logger.error(f"Failed to update job {job_id}", exc_info=True)

def upload_to_gcs_with_signed_url(job_id: str, audio_bytes: bytes) -> str:
    blob_name = f"jobs/{job_id}/output.wav"
    blob = bucket.blob(blob_name)
    blob.upload_from_string(audio_bytes, content_type="audio/wav")
    signed_url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(hours=24),
        method="GET",
    )
    logger.info(f"Uploaded gs://{GCS_BUCKET}/{blob_name}")
    return signed_url

@firestore.transactional
def release_credits(transaction, user_ref, cost: int):
    doc = transaction.get(user_ref)
    if doc.exists and not doc.to_dict().get("isPro", False):
        transaction.update(user_ref, {"pendingCredits": firestore.Increment(-cost)})

@firestore.transactional
def confirm_credits(transaction, user_ref, cost: int):
    doc = transaction.get(user_ref)
    if not doc.exists:
        return
    data = doc.to_dict()
    updates = {
        "totalVoicesGenerated": firestore.Increment(1),
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    if not data.get("isPro", False):
        updates["credits"] = firestore.Increment(-cost)
        updates["pendingCredits"] = firestore.Increment(-cost)
    transaction.update(user_ref, updates)

# === Routes ===
@app.before_request
def security_limits():
    # Block huge payloads
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

@app.route("/inference", methods=["POST"])
def inference():
    # Attach job_id to request for logging
    request.job_id = "NO_JOB"

    token = request.headers.get("X-Internal-Token")
    if token != INTERNAL_TOKEN:
        logger.warning("Unauthorized access attempt")
        abort(403)

    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    cost = data.get("cost", 1)
    raw_text = data.get("text", "").strip()
    voice_b64s = data.get("voice_samples", [])

    if not all([job_id, uid, raw_text, voice_b64s]):
        update_job_status(job_id or "unknown", "failed", error="Missing required fields")
        abort(400, "Missing required fields")

    request.job_id = job_id
    logger.info(f"Starting inference | user={uid} | cost={cost}")

    try:
        update_job_status(job_id, "processing")

        text = raw_text
        if not detect_multi_speaker(text):
            text = format_text_for_vibevoice(raw_text)

        voice_samples = map_speakers_to_voice_samples(text, voice_b64s)

        inputs = processor(
            text=[text],
            voice_samples=voice_samples,
            return_tensors="pt",
            padding=True,
        ).to(device)

        with torch.inference_mode():
            generated = model.generate(**inputs, do_sample=False, cfg_scale=1.3)
            audio = processor.decode(generated, skip_special_tokens=True)

        audio_np = audio.cpu().numpy().squeeze()
        audio_np = np.clip(audio_np, -1.0, 1.0)
        if np.abs(audio_np).max() > 0:
            audio_np = audio_np / np.abs(audio_np).max() * 0.95

        buffer = BytesIO()
        sf.write(buffer, audio_np, SAMPLE_RATE, format="WAV")
        audio_bytes = buffer.getvalue()

        signed_url = upload_to_gcs_with_signed_url(job_id, audio_bytes)

        # Confirm credits
        user_ref = db.collection("users").document(uid)
        confirm_credits(db.transaction(), user_ref, cost)

        expires_at = datetime.utcnow() + timedelta(hours=24)
        update_job_status(job_id, "completed", audioUrl=signed_url, expiresAt=expires_at, audioSize=len(audio_bytes))

        logger.info("Job completed successfully")
        return jsonify({"status": "completed", "audio_url": signed_url}), 200

    except torch.cuda.OutOfMemoryError:
        logger.error("GPU OOM", exc_info=True)
        update_job_status(job_id, "failed", error="GPU out of memory")
        user_ref = db.collection("users").document(uid)
        release_credits(db.transaction(), user_ref, cost)
        return jsonify({"error": "GPU OOM"}), 503

    except Exception as e:
        logger.error("Unexpected inference error", exc_info=True)
        update_job_status(job_id, "failed", error=str(e))
        user_ref = db.collection("users").document(uid)
        release_credits(db.transaction(), user_ref, cost)
        return jsonify({"error": "Internal error"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)