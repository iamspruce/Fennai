# functions/inference/utils/speaker_clustering.py
import numpy as np
import tempfile
from typing import List, Dict
from resemblyzer import VoiceEncoder, preprocess_wav
from sklearn.cluster import DBSCAN
from pydub import AudioSegment
import logging

logger = logging.getLogger(__name__)

# Initialize encoder (singleton)
encoder = None

def get_encoder():
    """Lazy load encoder"""
    global encoder
    if encoder is None:
        logger.info("Loading Resemblyzer encoder...")
        encoder = VoiceEncoder()
    return encoder


def cluster_speakers_embeddings(audio_chunk_paths: List[str]) -> Dict[int, int]:
    """
    Cluster audio chunks by speaker using voice embeddings
    Returns: {chunk_index: cluster_id}
    """
    enc = get_encoder()
    
    # Extract embeddings for each chunk
    embeddings = []
    valid_indices = []
    
    for i, path in enumerate(audio_chunk_paths):
        try:
            wav = preprocess_wav(path)
            
            # Skip very short chunks (< 0.5 seconds)
            if len(wav) < 8000:  # 16kHz * 0.5s
                logger.warning(f"Skipping chunk {i}: too short")
                continue
            
            embed = enc.embed_utterance(wav)
            embeddings.append(embed)
            valid_indices.append(i)
            
        except Exception as e:
            logger.error(f"Failed to process chunk {i}: {str(e)}")
            continue
    
    if not embeddings:
        raise ValueError("No valid embeddings extracted")
    
    embeddings = np.array(embeddings)
    
    # Cluster using DBSCAN (density-based clustering)
    # eps: maximum distance between samples to be considered neighbors
    # min_samples: minimum cluster size
    clustering = DBSCAN(eps=0.15, min_samples=2, metric='cosine')
    labels = clustering.fit_predict(embeddings)
    
    # Map back to original indices
    speaker_mapping = {}
    for valid_idx, label in zip(valid_indices, labels):
        # Handle noise points (label=-1)
        if label == -1:
            # Assign unique speaker ID
            label = max(labels) + 1 + valid_idx
        speaker_mapping[valid_idx] = int(label)
    
    # Fill in skipped chunks with nearest neighbor
    for i in range(len(audio_chunk_paths)):
        if i not in speaker_mapping:
            # Assign to previous speaker or 0
            speaker_mapping[i] = speaker_mapping.get(i-1, 0)
    
    unique_speakers = len(set(speaker_mapping.values()))
    logger.info(f"Clustered {len(audio_chunk_paths)} chunks into {unique_speakers} speakers")
    
    return speaker_mapping


def generate_speaker_sample(
    audio_path: str,
    segments: List[dict],
    target_duration: float = 15.0
) -> str:
    """
    Generate voice sample for a speaker by concatenating their segments
    Target: 15 seconds of audio
    """
    audio = AudioSegment.from_wav(audio_path)
    
    # Collect speaker segments
    speaker_audio = AudioSegment.empty()
    total_duration = 0.0
    
    for segment in segments:
        if total_duration >= target_duration:
            break
        
        start_ms = int(segment["startTime"] * 1000)
        end_ms = int(segment["endTime"] * 1000)
        chunk = audio[start_ms:end_ms]
        
        speaker_audio += chunk
        total_duration = len(speaker_audio) / 1000.0
    
    # Ensure minimum 2 seconds
    if total_duration < 2.0:
        logger.warning(f"Speaker sample too short: {total_duration}s")
        # Pad with silence if needed
        silence_duration = int((2.0 - total_duration) * 1000)
        speaker_audio += AudioSegment.silent(duration=silence_duration)
    
    # Truncate to target duration
    if total_duration > target_duration:
        speaker_audio = speaker_audio[:int(target_duration * 1000)]
    
    # Export
    output_path = tempfile.mktemp(suffix="_speaker_sample.wav")
    speaker_audio.export(output_path, format="wav")
    
    final_duration = len(speaker_audio) / 1000.0
    logger.info(f"Generated speaker sample: {final_duration:.1f}s")
    
    return output_path


def compute_speaker_similarity(embed1: np.ndarray, embed2: np.ndarray) -> float:
    """Compute cosine similarity between two speaker embeddings"""
    return np.dot(embed1, embed2) / (np.linalg.norm(embed1) * np.linalg.norm(embed2))