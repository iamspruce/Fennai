# functions/inference/main.py
"""
Voice cloning inference server with improved error handling,
resource management, and observability.
"""
import torch
import threading
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify

from firebase_admin import firestore, initialize_app, credentials

# Import configuration first
from config import config

# Setup logging
from utils.logging_config import setup_logging, add_request_id
setup_logging(config.LOG_LEVEL)

import logging
logger = logging.getLogger(__name__)

# Initialize Firebase - FIXED
import firebase_admin
if not firebase_admin._apps:
    cred = credentials.ApplicationDefault()
    initialize_app(cred)

db = firestore.client()

# Enable maximum performance
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

# Flask app
app = Flask(__name__)

# Model globals
processor = None
model = None
model_ready = threading.Event()
model_lock = threading.Lock()
START_TIME = datetime.utcnow()

# Import middleware
from middleware import (
    require_internal_token,
    validate_payload_size,
    handle_job_errors,
)

# Import route handlers
from routes.inference import inference_route
from routes.extract_audio import extract_audio_route
from routes.cluster_speakers import cluster_speakers_route
from routes.translate_transcript import translate_transcript_route
from routes.clone_audio import clone_audio_route
from routes.merge_audio import merge_audio_route
from routes.merge_video import merge_video_route


def load_model_async():
    """Load model in background thread"""
    global processor, model
    
    try:
        with model_lock:
            logger.info(f"Loading {config.MODEL_NAME}...")
            
            MODEL_DIR = Path(config.MODEL_DIR)
            if not MODEL_DIR.exists():
                raise RuntimeError(f"Model directory not found: {MODEL_DIR}")
            
            from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor
            from vibevoice.modular.modeling_vibevoice_inference import VibeVoiceForConditionalGenerationInference
            
            processor = VibeVoiceProcessor.from_pretrained(str(MODEL_DIR))
            
            dtype = torch.float16 if config.DEVICE == "cuda" else torch.float32
            loaded_model = VibeVoiceForConditionalGenerationInference.from_pretrained(
                str(MODEL_DIR),
                torch_dtype=dtype,
            )
            
            if isinstance(loaded_model, tuple):
                _model = loaded_model[0]
            else:
                _model = loaded_model
            
            # Ensure model is a Module (helps type checker and runtime safety)
            if not isinstance(_model, torch.nn.Module):
                raise TypeError(f"Expected model to be torch.nn.Module, got {type(_model)}")
            
            _model.to(config.DEVICE)
            _model.eval()
            _model.set_ddpm_inference_steps(config.DDPM_INFERENCE_STEPS)
            
            # Set attention mode
            from utils import get_optimal_attention_mode
            attn_mode = get_optimal_attention_mode()
            if hasattr(_model.config, "attention_type"):
                _model.config.attention_type = attn_mode
            
            # Compile model for performance
            if config.DEVICE == "cuda":
                logger.info("Compiling model...")
                _model = torch.compile(_model, mode=config.MODEL_COMPILE_MODE, fullgraph=True)
            
            model = _model
            model_ready.set()
            
            gpu_mem = torch.cuda.memory_allocated() / 1e9 if config.DEVICE == "cuda" else 0
            logger.info(f"Model loaded successfully! GPU memory: {gpu_mem:.2f} GB")
            logger.info(f"Attention mode: {attn_mode}")
            
    except Exception as e:
        logger.error("Failed to load model", exc_info=True)
        raise


# Start loading model in background
threading.Thread(target=load_model_async, daemon=True).start()


@app.before_request
def before_request():
    """Run before each request"""
    from flask import request, g
    
    # Add request ID for tracing
    add_request_id()
    
    # Ensure model is loaded
    if not model_ready.wait(timeout=300):
        return jsonify({"error": "Model not ready"}), 503
    
    # Initialize job_id
    g.job_id = "NO_JOB"


@app.after_request
def after_request(response):
    """Run after each request"""
    # Clear CUDA cache after each request to prevent OOM
    if config.DEVICE == "cuda":
        torch.cuda.empty_cache()
    
    return response


@app.route("/health", methods=["GET"])
def health():
    """Enhanced health check with dependency validation"""
    checks = {
        "model_loaded": model_ready.is_set(),
        "device": config.DEVICE,
        "uptime_seconds": round((datetime.utcnow() - START_TIME).total_seconds(), 1),
        "model": config.MODEL_NAME,
    }
    
    if config.DEVICE == "cuda":
        checks["gpu_memory_gb"] = round(torch.cuda.memory_allocated() / 1e9, 2)
    
    # Check Firebase
    try:
        db.collection("users").limit(1).get()
        checks["firebase"] = "ok"
    except Exception as e:
        checks["firebase"] = f"error: {str(e)}"
    
    # Check GCS
    try:
        from google.cloud import storage
        storage_client = storage.Client()
        bucket = storage_client.bucket(config.GCS_BUCKET)
        bucket.exists()
        checks["gcs"] = "ok"
    except Exception as e:
        checks["gcs"] = f"error: {str(e)}"
    
    # Overall status
    all_healthy = (
        checks["model_loaded"] and
        checks["firebase"] == "ok" and
        checks["gcs"] == "ok"
    )
    
    status_code = 200 if all_healthy else 503
    
    return jsonify({
        "status": "healthy" if all_healthy else "unhealthy",
        **checks
    }), status_code


# ============================================================================
# Register route handlers
# ============================================================================

# Voice Cloning Routes
@app.route("/inference", methods=["POST"])
@require_internal_token
@validate_payload_size
def inference():
    """
    Main inference endpoint - delegates to route handler.
    Note: We don't use @handle_job_errors here because the route
    needs custom error handling for GPU OOM and credit management.
    """
    return inference_route(processor, model)


# Dubbing Pipeline Routes
@app.route("/extract-audio", methods=["POST"])
@require_internal_token
@validate_payload_size
@handle_job_errors(collection="dubbingJobs")
def extract_audio():
    """Extract audio from video and start STT transcription"""
    return extract_audio_route()


@app.route("/cluster-speakers", methods=["POST"])
@require_internal_token
@handle_job_errors(collection="dubbingJobs")
def cluster_speakers():
    """Cluster speakers using voice embeddings"""
    return cluster_speakers_route()


@app.route("/translate-transcript", methods=["POST"])
@require_internal_token
@handle_job_errors(collection="dubbingJobs")
def translate_transcript():
    """Translate transcript to target language"""
    return translate_transcript_route()


@app.route("/clone-audio", methods=["POST"])
@require_internal_token
@handle_job_errors(collection="dubbingJobs")
def clone_audio():
    """Clone audio for dubbing chunk"""
    return clone_audio_route()


@app.route("/merge-audio", methods=["POST"])
@require_internal_token
@handle_job_errors(collection="dubbingJobs")
def merge_audio():
    """Merge all cloned audio chunks"""
    return merge_audio_route()


@app.route("/merge-video", methods=["POST"])
@require_internal_token
@handle_job_errors(collection="dubbingJobs")
def merge_video():
    """Replace video audio track with dubbed audio"""
    return merge_video_route()


if __name__ == "__main__":
    # Validate configuration
    config.validate()
    config.log_config()
    
    app.run(host="0.0.0.0", port=8080)