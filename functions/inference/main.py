# main.py
from flask import Flask, request, abort, jsonify
import os
import logging
import signal
import torch
from pathlib import Path
from io import BytesIO
import soundfile as sf

# === DO NOT import anything heavy here! ===
# No vibevoice, no download_model, no processor/model imports at top level

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]  # Ensures logs go to Cloud Run stdout
)
logger = logging.getLogger(__name__)

# === Config ===
device = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
CACHE_DIR = Path("/workspace/models")
SAMPLE_RATE = 24000
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")

# Global model/processor (lazy loaded)
processor = None
model = None

app = Flask(__name__)

# === Timeout handler ===
class TimeoutError(Exception):
    pass

def timeout_handler(signum, frame):
    raise TimeoutError("Generation took too long")

# === Lazy loading function (THIS IS THE KEY) ===
def ensure_model_loaded():
    global processor, model

    if model is not None and processor is not None:
        logger.info("Model already loaded")
        return

    logger.info("First request received → starting model download & load...")

    # ------------------------------
    # Lazy imports (only now!)
    # ------------------------------
    try:
        from download_model import download_if_missing
        from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor
        from vibevoice.modular.modeling_vibevoice_inference import (
            VibeVoiceForConditionalGenerationInference,
        )
        from utils import (
            get_optimal_attention_mode,
            b64_to_voice_sample,
            parse_dialogue_text,
            extract_per_speaker_texts,
            map_speakers_to_voice_samples,
            log_startup_info,
            detect_multi_speaker,
        )
        globals().update(locals())  # Make them available below
    except Exception as e:
        logger.error("Failed to import required modules!", exc_info=True)
        raise

    # ------------------------------
    # 1. Download model
    # ------------------------------
    try:
        logger.info(f"Checking for model {MODEL_NAME} in {CACHE_DIR}...")
        model_path = download_if_missing()
        if not model_path:
            logger.error("Model download failed or returned None")
            abort(503, "Model download failed")
        logger.info(f"Model ready at: {model_path}")
    except Exception as e:
        logger.error("Unexpected error during model download", exc_info=True)
        abort(503, "Model download crashed")

    # Find actual snapshot directory
    snapshot_dir = None
    repo_prefix = f"models--{MODEL_NAME.replace('/', '--')}"
    candidates = list(CACHE_DIR.glob(f"{repo_prefix}*/snapshots/*"))
    if candidates:
        snapshot_dir = candidates[0]
    if not snapshot_dir or not snapshot_dir.exists():
        logger.error(f"Could not find snapshot directory under {CACHE_DIR}")
        logger.error(f"Contents of /workspace/models: {list(CACHE_DIR.glob('**/*'))}")
        abort(503, "Model snapshot not found")

    logger.info(f"Loading model from snapshot: {snapshot_dir}")

    # ------------------------------
    # 2. Load processor & model
    # ------------------------------
    try:
        processor = VibeVoiceProcessor.from_pretrained(str(snapshot_dir))
        logger.info("Processor loaded")

        dtype = torch.float16 if device == "cuda" else torch.float32
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(
            str(snapshot_dir),
            torch_dtype=dtype,
        )
        logger.info("Model weights loaded")

        attn_mode = get_optimal_attention_mode()
        if hasattr(model.config, "attention_type"):
            model.config.attention_type = attn_mode
        model.to(device)
        model.eval()

        log_startup_info()
        logger.info("Model fully loaded and moved to device!")

    except Exception as e:
        logger.error("CRITICAL: Failed to load model/processor", exc_info=True)
        processor = None
        model = None
        abort(503, "Failed to load model")


# === Health endpoint (lightweight, no model load) ===
@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health():
    status = "healthy" if (model is not None and processor is not None) else "warming up"
    info = {
        "status": status,
        "model": MODEL_NAME,
        "device": device,
        "sample_rate": SAMPLE_RATE,
        "cuda": torch.cuda.is_available(),
    }
    if torch.cuda.is_available():
        info["gpu"] = torch.cuda.get_device_name(0)
    logger.info(f"Health check → {status}")
    return jsonify(info), 200


# === Inference endpoint ===
@app.route("/inference", methods=["POST"])
def inference():
    logger.info("Inference request received")

    # Auth
    token = request.headers.get("X-Internal-Token")
    if token != INTERNAL_TOKEN:
        logger.warning("Invalid or missing auth token")
        abort(403, "Forbidden")

    # Lazy load model
    ensure_model_loaded()

    try:
        data = request.get_json(silent=True) or {}
        raw_text = data.get("text", "").strip()
        voice_b64s = data.get("voice_samples", [])

        if not raw_text:
            abort(400, "Missing 'text'")
        if not voice_b64s or not isinstance(voice_b64s, list):
            abort(400, "Missing or invalid 'voice_samples'")

        # Multi-speaker logic
        if detect_multi_speaker(raw_text):
            dialogues = parse_dialogue_text(raw_text)
            texts = extract_per_speaker_texts(dialogues)
            voice_samples = map_speakers_to_voice_samples(dialogues, voice_b64s)
            logger.info(f"Multi-speaker: {len(texts)} parts")
        else:
            texts = [raw_text]
            voice_samples = [b64_to_voice_sample(voice_b64s[0])]
            logger.info("Single speaker mode")

        if len(texts) != len(voice_samples):
            abort(400, "Text/voice sample count mismatch")

        inputs = processor(
            text=texts,
            voice_samples=voice_samples,
            return_tensors="pt",
            padding=True,
        ).to(device)

        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(550)

        try:
            logger.info("Generating audio...")
            with torch.inference_mode():
                generated = model.generate(
                    **inputs,
                    max_new_tokens=2048,
                    do_sample=True,
                    temperature=0.7,
                    top_p=0.9,
                    cfg_scale=1.3,
                    inference_steps=10,
                )
        finally:
            signal.alarm(0)

        logger.info("Decoding audio...")
        audio = processor.decode(generated, skip_special_tokens=True)
        audio_np = audio.cpu().numpy().squeeze()

        if audio_np.size == 0:
            abort(500, "Generated empty audio")

        buffer = BytesIO()
        sf.write(buffer, audio_np, SAMPLE_RATE, format="WAV")
        buffer.seek(0)

        duration = len(audio_np) / SAMPLE_RATE
        logger.info(f"Success: Generated {duration:.2f}s of audio")

        return buffer.getvalue(), 200, {"Content-Type": "audio/wav"}

    except TimeoutError:
        logger.error("Generation timeout (>550s)")
        abort(504, "Generation timeout")
    except Exception as e:
        logger.error("Inference failed", exc_info=True)
        abort(500, "Internal error during inference")
    finally:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    logger.info(f"Starting Flask server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=False)