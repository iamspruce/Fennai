# main.py
from flask import Flask, request, abort, jsonify, send_file
import os
import logging
import torch
from pathlib import Path
from io import BytesIO
import soundfile as sf
import numpy as np

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

# Config
device = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/models"))  # ← From Persistent Disk
SAMPLE_RATE = 24000
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")

processor = None
model = None

def ensure_model_loaded():
    global processor, model
    if model is not None:
        return

    logger.info("Loading VibeVoice model...")
    from download_model import download_if_missing
    from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor
    from vibevoice.modular.modeling_vibevoice_inference import VibeVoiceForConditionalGenerationInference

    # This returns the exact snapshot directory
    snapshot_dir = Path(download_if_missing())

    logger.info(f"Loading model from {snapshot_dir}")

    processor = VibeVoiceProcessor.from_pretrained(str(snapshot_dir))
    dtype = torch.float16 if device == "cuda" else torch.float32
    model = VibeVoiceForConditionalGenerationInference.from_pretrained(
        str(snapshot_dir),
        torch_dtype=dtype,
    )

    # Attention mode
    attn_mode = get_optimal_attention_mode()
    if hasattr(model.config, "attention_type"):
        model.config.attention_type = attn_mode

    model.to(device)
    model.eval()
    model.set_ddpm_inference_steps(10)  # Critical!

    log_startup_info()
    logger.info("Model loaded and ready!")

@app.route("/health", methods=["GET"])
def health():
    ensure_model_loaded()
    return jsonify({
        "status": "healthy",
        "model": MODEL_NAME,
        "device": device,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "cache_dir": str(CACHE_DIR),
    })

@app.route("/inference", methods=["POST"])
def inference():
    ensure_model_loaded()

    token = request.headers.get("X-Internal-Token")
    if token != INTERNAL_TOKEN:
        abort(403, "Forbidden")

    data = request.get_json() or {}
    raw_text = data.get("text", "").strip()
    voice_b64s = data.get("voice_samples", [])

    if not raw_text:
        abort(400, "Missing 'text'")
    if not voice_b64s:
        abort(400, "Missing 'voice_samples'")

    # Text formatting
    text_to_use = raw_text.strip()
    if not detect_multi_speaker(text_to_use):
        text_to_use = format_text_for_vibevoice(raw_text)

    logger.info(f"Using text:\n{text_to_use}")

    # Voice samples
    voice_samples = map_speakers_to_voice_samples(text_to_use, voice_b64s)

    # Inference
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

    # Post-process
    audio_np = np.clip(audio_np, -1.0, 1.0)
    if np.abs(audio_np).max() > 0:
        audio_np = audio_np / np.abs(audio_np).max() * 0.95

    buffer = BytesIO()
    sf.write(buffer, audio_np, SAMPLE_RATE, format="WAV")
    buffer.seek(0)

    return send_file(
        buffer,
        mimetype="audio/wav",
        as_attachment=True,
        download_name="output.wav"
    )
