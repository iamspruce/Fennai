# functions/inference/main.py
import functions_framework
from flask import abort
import torch
import numpy as np
import soundfile as sf
from io import BytesIO
import os
import logging
import signal
from pathlib import Path

from download_model import download_if_missing

# VibeVoice imports
from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor
from vibevoice.modular.modeling_vibevoice_inference import (
    VibeVoiceForConditionalGenerationInference,
)

# Local utils
from utils import (
    get_optimal_attention_mode,
    b64_to_voice_sample,
    parse_dialogue_text,
    extract_per_speaker_texts,
    map_speakers_to_voice_samples,
    log_startup_info,
    detect_multi_speaker,
)

# === Configuration ===
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

device = "cuda" if torch.cuda.is_available() else "cpu"
attention_mode = get_optimal_attention_mode()
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")

MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
CACHE_DIR = Path("/workspace/models")
SAMPLE_RATE = 24000

processor = None
model = None


# -----------------------------------------------------
# Timeout Handler
# -----------------------------------------------------
class TimeoutError(Exception):
    pass


def timeout_handler(signum, frame):
    raise TimeoutError("Generation timeout")


# -----------------------------------------------------
# Helper: Find snapshot folder inside HF cache
# -----------------------------------------------------
def get_snapshot_path():
    repo_prefix = f"models--{MODEL_NAME.replace('/', '--')}"
    matches = list(CACHE_DIR.glob(repo_prefix + "/snapshots/*"))
    return matches[0] if matches else None


# -----------------------------------------------------
# Model Loading (Lazy)
# -----------------------------------------------------
def load_model():
    global processor, model

    logger.info(f"Preparing model: {MODEL_NAME}")

    # Ensure model is downloaded
    download_if_missing()

    # Locate the HF snapshot
    snapshot_dir = get_snapshot_path()
    if not snapshot_dir:
        logger.error("Model snapshot directory not found!")
        processor = None
        model = None
        return False

    logger.info(f"Using snapshot dir: {snapshot_dir}")

    try:
        # Load processor
        processor = VibeVoiceProcessor.from_pretrained(str(snapshot_dir))
        logger.info("✓ Processor loaded")

        # Load model
        dtype = torch.float16 if device == "cuda" else torch.float32
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(
            str(snapshot_dir),
            torch_dtype=dtype,
        )
        logger.info("✓ Model loaded")

        # Attention mode
        if hasattr(model.config, "attention_type"):
            model.config.attention_type = attention_mode
            logger.info(f"✓ Attention mode: {attention_mode}")

        # Move to GPU/CPU
        model.to(device)
        model.eval()

        log_startup_info()
        logger.info("✓ Model fully ready")

        return True

    except Exception as e:
        logger.error(f"Model load failed: {e}", exc_info=True)
        processor = None
        model = None
        return False


# -----------------------------------------------------
# Ensure Model is Loaded (Lazy Loading)
# -----------------------------------------------------
def ensure_model_loaded():
    global processor, model
    
    if model is None or processor is None:
        logger.info("Model not loaded yet, loading now...")
        success = load_model()
        if not success:
            abort(503, "Model failed to load")


# -----------------------------------------------------
# Request Validation
# -----------------------------------------------------
def validate_request(data):
    """Validate incoming request data."""
    raw_text = data.get("text", "").strip()
    voice_b64s = data.get("voice_samples", [])
    
    if not raw_text:
        abort(400, "Missing text")
    if not voice_b64s:
        abort(400, "Missing voice_samples")
    if not isinstance(voice_b64s, list):
        abort(400, "voice_samples must be an array")
    
    return raw_text, voice_b64s


# -----------------------------------------------------
# Inference Endpoint
# -----------------------------------------------------
@functions_framework.http
def inference(request):
    # Lazy load model on first request
    ensure_model_loaded()
    
    # Authentication
    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        logger.warning("Unauthorized request")
        abort(403, "Forbidden")

    try:
        # Parse and validate request
        data = request.get_json(silent=True) or {}
        raw_text, voice_b64s = validate_request(data)
        
        # Log request details
        trace_id = request.headers.get('X-Cloud-Trace-Context', 'unknown')
        logger.info(f"Request ID: {trace_id}")
        logger.info(f"Input: {len(raw_text)} chars, {len(voice_b64s)} voice samples")

        # Multi-speaker detection and processing
        is_multi = detect_multi_speaker(raw_text)
        
        if is_multi:
            dialogues = parse_dialogue_text(raw_text)
            texts = extract_per_speaker_texts(dialogues)
            voice_samples = map_speakers_to_voice_samples(dialogues, voice_b64s)
            logger.info(f"Multi-speaker mode: {len(set(s for s, _ in dialogues))} unique speakers")
        else:
            texts = [raw_text]
            voice_samples = [b64_to_voice_sample(voice_b64s[0])]
            logger.info("Single speaker mode")

        # Validation
        if len(texts) != len(voice_samples):
            abort(400, f"Voice/text mismatch: {len(texts)} texts, {len(voice_samples)} samples")

        # Prepare inputs
        inputs = processor(
            text=texts,
            voice_samples=voice_samples,
            return_tensors="pt",
            padding=True,
        ).to(device)

        # Set timeout (550s to leave buffer for Cloud Run 600s limit)
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(550)

        try:
            # Generate with proper parameters
            with torch.inference_mode():
                generated = model.generate(
                    **inputs,
                    max_new_tokens=2048,
                    do_sample=True,
                    temperature=0.7,
                    top_p=0.9,
                    cfg_scale=1.3,          # Voice adherence
                    inference_steps=10,     # Generation quality
                )
        finally:
            signal.alarm(0)  # Cancel timeout

        # Decode
        audio = processor.decode(generated, skip_special_tokens=True)
        audio_np = audio.cpu().numpy().squeeze()

        if audio_np.size == 0:
            abort(500, "Generated empty audio")

        # WAV output
        buffer = BytesIO()
        sf.write(buffer, audio_np, SAMPLE_RATE, format="WAV")
        buffer.seek(0)

        duration = audio_np.size / SAMPLE_RATE
        logger.info(f"✓ Done: {duration:.2f}s audio generated")

        return (buffer.getvalue(), 200, {"Content-Type": "audio/wav"})

    except TimeoutError:
        logger.error("Generation timed out")
        abort(504, "Request timeout - text may be too long")
    
    except Exception as e:
        logger.error(f"Inference failed: {e}", exc_info=True)
        abort(500, str(e))
    
    finally:
        # Clean up GPU memory
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


# -----------------------------------------------------
# Health Endpoint
# -----------------------------------------------------
@functions_framework.http
def health(request):
    """Health check endpoint for Cloud Run."""
    # Check if model can be loaded (but don't force load if not needed)
    health_status = {
        "status": "healthy" if (model is not None and processor is not None) else "initializing",
        "device": device,
        "model": MODEL_NAME,
        "sample_rate": SAMPLE_RATE
    }
    
    if model is None or processor is None:
        # Model not loaded yet, but container is healthy
        return health_status, 200
    
    return health_status, 200