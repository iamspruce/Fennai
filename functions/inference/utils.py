# functions/inference/utils.py
import torch
import numpy as np
import librosa
import soundfile as sf
from io import BytesIO
import base64
import os
import logging
import re
from typing import List, Tuple, Dict

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
    if not torch.cuda.is_available():
        return "sdpa"
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

# === 3. Multi-Character Dialogue Parser (from your original speak.py) ===
def parse_dialogue_text(text: str) -> List[Tuple[str, str]]:
    """
    Input: "Speaker 1: Hello there\nSpeaker 2: Hi! How are you?"
    Output: [("Speaker 1", "Hello there"), ("Speaker 2", "Hi! How are you?")]
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    dialogues = []
    pattern = re.compile(r"^(Speaker\s*\d+|Character\s*\d+|\w+):\s*(.+)", re.IGNORECASE)

    for line in lines:
        match = pattern.match(line)
        if match:
            speaker = match.group(1).strip()
            utterance = match.group(2).strip()
            dialogues.append((speaker, utterance))
        else:
            # Fallback: treat as continuation of previous speaker
            if dialogues:
                prev_speaker, prev_text = dialogues[-1]
                dialogues[-1] = (prev_speaker, prev_text + " " + line.strip())
    return dialogues

def extract_per_speaker_texts(dialogues: List[Tuple[str, str]]) -> List[str]:
    """Return list of texts in speaker order (for model input)."""
    return [utterance for _, utterance in dialogues]

def map_speakers_to_voice_samples(
    dialogues: List[Tuple[str, str]],
    voice_samples_b64: List[str]
) -> List[np.ndarray]:
    """
    Map voice samples to speakers by order.
    Assumes voice_samples_b64[0] = Speaker 1, voice_samples_b64[1] = Speaker 2, etc.
    """
    speaker_to_index = {}
    for i, (speaker, _) in enumerate(dialogues):
        speaker_key = re.split(r"\s+", speaker.strip(), 1)[0].lower()
        if speaker_key not in speaker_to_index:
            speaker_to_index[speaker_key] = i

    ordered_samples = []
    used_indices = set()
    for speaker, _ in dialogues:
        speaker_key = re.split(r"\s+", speaker.strip(), 1)[0].lower()
        idx = speaker_to_index.get(speaker_key, 0)
        if idx >= len(voice_samples_b64):
            idx = 0
        if idx not in used_indices:
            used_indices.add(idx)
        ordered_samples.append(b64_to_voice_sample(voice_samples_b64[idx]))
    return ordered_samples

# === 4. Startup Logger ===
def log_startup_info():
    attn = get_optimal_attention_mode()
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    logger.info("=== VibeVoice Multi-Speaker Inference Ready ===")
    logger.info(f"Device: {gpu} | Attention: {attn}")
    logger.info(f"Model: {os.getenv('MODEL_PATH', 'VibeVoice-1.5B')}")

# === 5. GPU Info ===
def get_detailed_gpu_info():
    if not torch.cuda.is_available():
        return {"available": False}
    return {
        "available": True,
        "name": torch.cuda.get_device_name(0),
        "memory_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
    }