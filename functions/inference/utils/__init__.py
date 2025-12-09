# functions/inference/utils/__init__.py
import torch
import numpy as np
import librosa
import soundfile as sf
from io import BytesIO
import base64
import re
import logging
from typing import List, Tuple

logger = logging.getLogger(__name__)

# === 1. Flash Attention ===
def check_flash_attn_available() -> bool:
    try:
        import flash_attn
        if torch.cuda.is_available():
            major, _ = torch.cuda.get_device_capability()
            return major >= 8
        return False
    except ImportError:
        return False

def get_optimal_attention_mode() -> str:
    return "flash_attention_2" if check_flash_attn_available() else "sdpa"

# === 2. Audio Preprocessing ===
def preprocess_audio(audio_bytes: bytes, target_sr: int = 24000) -> np.ndarray:
    audio, sr = sf.read(BytesIO(audio_bytes))
    if len(audio.shape) > 1:
        audio = librosa.to_mono(audio.T)
    if sr != target_sr:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
    audio, _ = librosa.effects.trim(audio, top_db=40)
    if np.abs(audio).max() > 0:
        audio = audio / np.abs(audio).max() * 0.95
    return audio.astype(np.float32)

def b64_to_voice_sample(b64_str: str) -> np.ndarray:
    return preprocess_audio(base64.b64decode(b64_str))

# === 3. Detect Multi-Speaker (Keep – it's perfect) ===
def detect_multi_speaker(text: str) -> bool:
    patterns = [
        r'(?:Speaker|Character|Person)\s*\d+\s*:',
        r'^\w+\s*:',
    ]
    matches = sum(len(re.findall(p, text, re.MULTILINE | re.IGNORECASE)) for p in patterns)
    return matches > 1

# === 4. Format Text for Single Speaker (Keep – perfect) ===
def format_text_for_vibevoice(text: str) -> str:
    sentences = [s.strip() for s in text.split('.') if s.strip()]
    formatted = [f"Speaker 1: {s}." for s in sentences]
    return "\n".join(formatted)

# === 5. Map Voice Samples to Speaker Order (Keep – perfect) ===
def map_speakers_to_voice_samples(
    text: str,
    voice_samples_b64: List[str]
) -> List[np.ndarray]:
    """
    Returns voice samples in correct order based on first appearance in text.
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    seen_speakers = {}
    ordered_samples = []

    pattern = re.compile(r'^(?:Speaker\s*\d+|\w+):\s*(.*)', re.IGNORECASE)

    for line in lines:
        match = pattern.match(line)
        if not match:
            continue
        speaker_label = line.split(':', 1)[0].strip().lower()

        if speaker_label not in seen_speakers:
            idx = len(seen_speakers)
            if idx < len(voice_samples_b64):
                sample = b64_to_voice_sample(voice_samples_b64[idx])
            else:
                logger.warning(f"Not enough voice samples, reusing first one")
                sample = b64_to_voice_sample(voice_samples_b64[0])
            seen_speakers[speaker_label] = sample
            ordered_samples.append(sample)

    # Fallback: if no valid speakers found, use all provided samples
    if not ordered_samples and voice_samples_b64:
        return [b64_to_voice_sample(b64) for b64 in voice_samples_b64]

    return ordered_samples

# === 6. Startup Logger ===
def log_startup_info():
    attn = get_optimal_attention_mode()
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    logger.info("=== VibeVoice Multi-Speaker Inference Ready ===")
    logger.info(f"Device: {gpu} | Attention: {attn}")
    logger.info("Model: Ready for inference")

# === 7. GPU Info ===
def get_detailed_gpu_info():
    if not torch.cuda.is_available():
        return {"available": False}
    return {
        "available": True,
        "name": torch.cuda.get_device_name(0),
        "memory_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1),
        "capability": torch.cuda.get_device_capability(0)
    }