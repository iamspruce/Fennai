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

# === 3. Multi-Speaker Detection ===
def detect_multi_speaker(text: str) -> bool:
    """
    Detect if text contains multiple speakers.
    Looks for patterns like "Speaker 1:", "Character 2:", "Alice:", etc.
    """
    patterns = [
        r'(?:Speaker|Character|Person)\s*\d+\s*:',  # "Speaker 1:", "Character 2:"
        r'^\w+\s*:',  # "Alice:", "Bob:" at start of line
    ]
    
    matches = 0
    for pattern in patterns:
        matches += len(re.findall(pattern, text, re.MULTILINE | re.IGNORECASE))
    
    return matches > 1

# === 4. Multi-Character Dialogue Parser ===
def parse_dialogue_text(text: str) -> List[Tuple[str, str]]:
    """
    Input: "Speaker 1: Hello there\nSpeaker 2: Hi! How are you?"
    Output: [("Speaker 1", "Hello there"), ("Speaker 2", "Hi! How are you?")]
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    dialogues = []
    pattern = re.compile(r"^(Speaker\s*\d+|Character\s*\d+|\w+)\s*:\s*(.+)", re.IGNORECASE)

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
    """
    Extract unique speakers and their combined texts.
    Returns list of texts, one per unique speaker in order of first appearance.
    """
    speaker_texts = {}
    speaker_order = []
    
    for speaker, utterance in dialogues:
        speaker_key = speaker.strip().lower()
        if speaker_key not in speaker_texts:
            speaker_texts[speaker_key] = []
            speaker_order.append(speaker_key)
        speaker_texts[speaker_key].append(utterance)
    
    # Combine all utterances per speaker
    return [" ".join(speaker_texts[s]) for s in speaker_order]

def map_speakers_to_voice_samples(
    dialogues: List[Tuple[str, str]],
    voice_samples_b64: List[str]
) -> List[np.ndarray]:
    """
    Map unique speakers to voice samples.
    Assumes voice_samples_b64[0] = first speaker, voice_samples_b64[1] = second speaker, etc.
    Returns one voice sample per unique speaker in order of first appearance.
    """
    unique_speakers = []
    speaker_to_sample = {}
    
    for speaker, _ in dialogues:
        speaker_key = speaker.strip().lower()
        
        # Only process each unique speaker once
        if speaker_key not in speaker_to_sample:
            idx = len(unique_speakers)
            
            # Use corresponding voice sample or default to first one
            if idx < len(voice_samples_b64):
                speaker_to_sample[speaker_key] = b64_to_voice_sample(voice_samples_b64[idx])
            else:
                # Fall back to first voice sample if not enough provided
                logger.warning(f"Not enough voice samples for speaker '{speaker}', using first sample")
                speaker_to_sample[speaker_key] = b64_to_voice_sample(voice_samples_b64[0])
            
            unique_speakers.append(speaker_key)
    
    # Return voice samples in order of first speaker appearance
    return [speaker_to_sample[s] for s in unique_speakers]

# === 5. Startup Logger ===
def log_startup_info():
    attn = get_optimal_attention_mode()
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    logger.info("=== VibeVoice Multi-Speaker Inference Ready ===")
    logger.info(f"Device: {gpu} | Attention: {attn}")
    logger.info(f"Model: {os.getenv('MODEL_NAME', 'VibeVoice-1.5B')}")

# === 6. GPU Info ===
def get_detailed_gpu_info():
    if not torch.cuda.is_available():
        return {"available": False}
    return {
        "available": True,
        "name": torch.cuda.get_device_name(0),
        "memory_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1),
        "capability": torch.cuda.get_device_capability(0)
    }