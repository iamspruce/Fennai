# functions/inference/main.py
import functions_framework
from flask import abort, request
import torch
import numpy as np
import soundfile as sf
from io import BytesIO
import os
from dotenv import load_dotenv

load_dotenv()

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

# === Globals ===
device = "cuda" if torch.cuda.is_available() else "cpu"
attention_mode = get_optimal_attention_mode()
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")

# Model configuration
MODEL_ID = "vibevoice/VibeVoice-1.5B"  # Replace with actual HuggingFace model ID
MODEL_CACHE_DIR = "/workspace/models"
MODEL_PATH = os.path.join(MODEL_CACHE_DIR, "VibeVoice-1.5B")

processor = None
model = None

def load_model():
    global processor, model
    print(f"Loading VibeVoice on {device} with {attention_mode}...")
    
    # Check if model is already cached
    if not os.path.exists(MODEL_PATH):
        print(f"Model not found at {MODEL_PATH}, downloading from HuggingFace...")
        os.makedirs(MODEL_CACHE_DIR, exist_ok=True)
        
        # Download from HuggingFace
        processor = VibeVoiceProcessor.from_pretrained(
            MODEL_ID,
            cache_dir=MODEL_CACHE_DIR
        )
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(
            MODEL_ID,
            cache_dir=MODEL_CACHE_DIR
        )
        print(f"✓ Model downloaded and cached to {MODEL_PATH}")
    else:
        print(f"Loading cached model from {MODEL_PATH}")
        processor = VibeVoiceProcessor.from_pretrained(MODEL_PATH)
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(MODEL_PATH)
    
    # Configure attention mode
    if hasattr(model.config, "attention_type"):
        model.config.attention_type = attention_mode
    
    model.to(device)
    model.eval()
    log_startup_info()
    print("✓ Model loaded and ready")

# Load on cold start
load_model()

@functions_framework.http
def inference(request):
    # Verify internal token
    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        abort(403)
    
    data = request.get_json() or {}
    raw_text = data.get("text", "").strip()
    voice_b64s = data.get("voice_samples", [])
    
    if not raw_text or not voice_b64s:
        abort(400, "Missing text or voice_samples")
    
    # === Detect Multi-Character Mode ===
    dialogues = parse_dialogue_text(raw_text)
    is_multi = len(dialogues) > 1 and any("speaker" in s.lower() or "character" in s.lower() for s, _ in dialogues)
    
    if is_multi:
        # Multi-speaker: map voices correctly
        texts = extract_per_speaker_texts(dialogues)
        voice_samples = map_speakers_to_voice_samples(dialogues, voice_b64s)
    else:
        # Single speaker
        texts = [raw_text]
        voice_samples = [b64_to_voice_sample(voice_b64s[0])]
    
    # === Generate ===
    inputs = processor(
        text=texts,
        voice_samples=voice_samples,
        return_tensors="pt",
        padding=True
    ).to(device)
    
    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            max_new_tokens=2048,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
        )
    
    audio = processor.decode(generated, skip_special_tokens=True)
    audio_np = audio.cpu().numpy().squeeze()
    
    buffer = BytesIO()
    sf.write(buffer, audio_np, 24000, format="WAV")
    buffer.seek(0)
    
    return (buffer.getvalue(), 200, {"Content-Type": "audio/wav"})