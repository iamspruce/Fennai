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

# === Google Cloud clients from shared module (correct ADC init!) ===
from shared.firebase import db  # ← This is now the single source of truth

# Enable maximum performance on NVIDIA L4 / A100
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

# === Logging with job_id in every line ===
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

# GCS client (uses same ADC as Firebase)
from google.cloud import storage
storage_client = storage.Client()
bucket = storage_client.bucket(GCS_BUCKET)

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

# === Load model at container startup (no cold-start latency) ===
def load_model():
    global processor, model
    logger.info("Container boot → loading VibeVoice-1.5B into GPU memory...")

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

        # Optimal attention
        attn_mode = get_optimal_attention_mode()
        if hasattr(model.config, "attention_type"):
            model.config.attention_type = attn_mode

        # 20–40% faster inference on L4
        if device == "cuda":
            logger.info("Applying torch.compile() for maximum speed...")
            model = torch.compile(model, mode="reduce-overhead", fullgraph=True)

        log_startup_info()
        logger.info(f"Model ready! GPU memory: {torch.cuda.memory_allocated()/1e9:.2f} GB")

    except Exception as e:
        logger.error("Failed to load model", exc_info=True)
        raise

# === Actually load it now ===
load_model()

# === Helper functions ===
def update_job_status(job_id: str, status: str, **kwargs):
    try:
        job_ref = db.collection("voiceJobs").document(job_id)
        updates = {"status": status, "updatedAt": firestore.SERVER_TIMESTAMP}
        updates.update(kwargs)
        job_ref.update(updates)
    except Exception as e:
        logger.error("Failed to update job status", exc_info=True)

def upload_audio(job_id: str, audio_bytes: bytes) -> str:
    blob_name = f"jobs/{job_id}/output.wav"
    blob = bucket.blob(blob_name)
    blob.upload_from_string(audio_bytes, content_type="audio/wav")
    url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(hours=24),
        method="GET",
    )
    logger.info(f"Uploaded gs://{GCS_BUCKET}/{blob_name}")
    return url

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

@app.route("/inference", methods=["POST"])
def inference():
    request.job_id = "NO_JOB"

    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        logger.warning("Unauthorized inference request")
        abort(403)

    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    cost = int(data.get("cost", 1))
    text = data.get("text", "").strip()
    voice_samples_b64 = data.get("voice_samples", [])

    if not all([job_id, uid, text, voice_samples_b64]):
        update_job_status(job_id or "unknown", "failed", error="Missing fields")
        abort(400, "Missing required fields")

    request.job_id = job_id
    logger.info(f"Inference start | user={uid} | cost={cost}")

    try:
        update_job_status(job_id, "processing")

        final_text = text
        if not detect_multi_speaker(text):
            final_text = format_text_for_vibevoice(text)

        voice_samples = map_speakers_to_voice_samples(final_text, voice_samples_b64)

        inputs = processor(
            text=[final_text],
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

        signed_url = upload_audio(job_id, audio_bytes)

        user_ref = db.collection("users").document(uid)
        confirm_credits(db.transaction(), user_ref, cost)

        expires_at = datetime.utcnow() + timedelta(hours=24)
        update_job_status(
            job_id,
            "completed",
            audioUrl=signed_url,
            expiresAt=expires_at,
            audioSize=len(audio_bytes)
        )

        logger.info("Job completed")
        return jsonify({"status": "completed", "audio_url": signed_url}), 200

    except torch.cuda.OutOfMemoryError:
        logger.error("GPU OOM", exc_info=True)
        update_job_status(job_id, "failed", error="Out of memory")
        user_ref = db.collection("users").document(uid)
        release_credits(db.transaction(), user_ref, cost)
        return jsonify({"error": "GPU OOM"}), 503

    except Exception as e:
        logger.error("Inference failed", exc_info=True)
        update_job_status(job_id, "failed", error=str(e))
        user_ref = db.collection("users").document(uid)
        release_credits(db.transaction(), user_ref, cost)
        return jsonify({"error": "Internal error"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)