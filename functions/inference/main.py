# functions/inference/main.py
import functions_framework
from flask import abort
import torch
import numpy as np
import soundfile as sf
from io import BytesIO
import os
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Your VibeVoice imports
from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor
from vibevoice.modular.modeling_vibevoice_inference import VibeVoiceForConditionalGenerationInference

# Local utils
from utils import (
    get_optimal_attention_mode,
    b64_to_voice_sample,
    parse_dialogue_text,
    extract_per_speaker_texts,
    map_speakers_to_voice_samples,
    log_startup_info
)

# === Configuration ===
device = "cuda" if torch.cuda.is_available() else "cpu"
attention_mode = get_optimal_attention_mode()
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")

# Model configuration - must match download_model.py
MODEL_NAME = "vibevoice/VibeVoice-1.5B"
MODEL_CACHE_DIR = Path("/workspace/models")
MODEL_PATH = MODEL_CACHE_DIR / "VibeVoice-1.5B"

# === Globals ===
processor = None
model = None

def load_model():
    """Load the pre-downloaded VibeVoice model from Docker image"""
    global processor, model
    logger.info(f"Loading VibeVoice on {device} with {attention_mode}...")
    
    try:
        # Model should already exist from Docker build
        if not MODEL_PATH.exists():
            logger.error(f"Model not found at {MODEL_PATH}!")
            logger.error("Model should have been downloaded during Docker build")
            raise FileNotFoundError(f"Model not found at {MODEL_PATH}")
        
        # Verify essential files exist
        required_files = ['config.json', 'tokenizer_config.json']
        missing_files = [
            f for f in required_files 
            if not (MODEL_PATH / f).exists()
        ]
        
        if missing_files:
            logger.error(f"Missing required files: {missing_files}")
            raise FileNotFoundError(f"Incomplete model cache: missing {missing_files}")
        
        logger.info(f"Loading cached model from {MODEL_PATH}")
        
        # Load processor
        processor = VibeVoiceProcessor.from_pretrained(str(MODEL_PATH))
        logger.info("✓ Processor loaded")
        
        # Load model
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(
            str(MODEL_PATH),
            torch_dtype=torch.float16 if device == "cuda" else torch.float32
        )
        logger.info("✓ Model loaded")
        
        # Configure attention mode
        if hasattr(model.config, "attention_type"):
            model.config.attention_type = attention_mode
            logger.info(f"✓ Attention mode set to: {attention_mode}")
        
        # Move to device and set eval mode
        model.to(device)
        model.eval()
        
        log_startup_info()
        logger.info("✓ Model ready for inference")
        
    except Exception as e:
        logger.error(f"Failed to load model: {e}", exc_info=True)
        raise

# Load model on cold start
try:
    load_model()
except Exception as e:
    logger.critical(f"FATAL: Model loading failed during startup: {e}")
    # Let the container start anyway so health checks can report the error
    # In production, you might want to exit here instead

@functions_framework.http
def inference(request):
    """
    Cloud Run inference endpoint for VibeVoice
    
    Expected JSON body:
    {
        "text": "Your text here or Speaker 1: Hello\\nSpeaker 2: Hi there",
        "voice_samples": ["base64_encoded_audio1", "base64_encoded_audio2", ...]
    }
    
    Returns: WAV audio file
    """
    # Check if model loaded successfully
    if model is None or processor is None:
        logger.error("Model not loaded - cannot process inference")
        abort(503, "Model not loaded")
    
    # Verify internal token
    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        logger.warning("Unauthorized access attempt")
        abort(403, "Forbidden")
    
    try:
        # Parse request
        data = request.get_json(silent=True) or {}
        raw_text = data.get("text", "").strip()
        voice_b64s = data.get("voice_samples", [])
        
        # Validate inputs
        if not raw_text:
            abort(400, "Missing 'text' field")
        if not voice_b64s:
            abort(400, "Missing 'voice_samples' field")
        if not isinstance(voice_b64s, list):
            abort(400, "'voice_samples' must be an array")
        
        logger.info(f"Processing inference request: {len(raw_text)} chars, {len(voice_b64s)} voice samples")
        
        # === Detect Multi-Character Mode ===
        dialogues = parse_dialogue_text(raw_text)
        is_multi = len(dialogues) > 1 and any(
            "speaker" in s.lower() or "character" in s.lower() 
            for s, _ in dialogues
        )
        
        if is_multi:
            # Multi-speaker: map voices correctly
            texts = extract_per_speaker_texts(dialogues)
            voice_samples = map_speakers_to_voice_samples(dialogues, voice_b64s)
            logger.info(f"Multi-speaker mode: {len(texts)} speakers")
        else:
            # Single speaker
            texts = [raw_text]
            voice_samples = [b64_to_voice_sample(voice_b64s[0])]
            logger.info("Single-speaker mode")
        
        # Validate voice samples count
        if len(texts) != len(voice_samples):
            logger.error(f"Mismatch: {len(texts)} texts but {len(voice_samples)} voice samples")
            abort(400, f"Voice sample count mismatch: need {len(texts)} samples, got {len(voice_samples)}")
        
        # === Process Inputs ===
        logger.info("Processing inputs...")
        inputs = processor(
            text=texts,
            voice_samples=voice_samples,
            return_tensors="pt",
            padding=True
        ).to(device)
        
        # === Generate Audio ===
        logger.info("Generating audio...")
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=2048,
                do_sample=True,
                temperature=0.7,
                top_p=0.9,
            )
        
        # === Decode Audio ===
        logger.info("Decoding audio...")
        audio = processor.decode(generated, skip_special_tokens=True)
        audio_np = audio.cpu().numpy().squeeze()
        
        # Validate audio
        if audio_np.size == 0:
            logger.error("Generated empty audio")
            abort(500, "Generated empty audio")
        
        # Convert to WAV format
        buffer = BytesIO()
        sf.write(buffer, audio_np, 24000, format="WAV")
        buffer.seek(0)
        
        audio_duration = len(audio_np) / 24000
        logger.info(f"✓ Inference completed: {audio_duration:.2f}s audio generated")
        
        return (buffer.getvalue(), 200, {"Content-Type": "audio/wav"})
        
    except Exception as e:
        logger.error(f"Inference error: {e}", exc_info=True)
        abort(500, f"Inference failed: {str(e)}")

# Health check endpoint (optional but recommended)
@functions_framework.http
def health(request):
    """Health check endpoint"""
    if model is None or processor is None:
        return {"status": "unhealthy", "reason": "Model not loaded"}, 503
    
    return {"status": "healthy", "device": device, "model": MODEL_NAME}, 200