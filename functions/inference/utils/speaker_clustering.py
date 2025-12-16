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


def cluster_speakers_embeddings(
    audio_chunk_paths: List[str],
    eps: float = 0.15,
    min_samples: int = 2
) -> Dict[int, int]:
    """
    Cluster audio chunks by speaker using voice embeddings
    
    Args:
        audio_chunk_paths: List of paths to audio chunks
        eps: Maximum cosine distance between samples to be neighbors (default: 0.15)
             Lower = stricter clustering (more speakers)
             Higher = looser clustering (fewer speakers)
        min_samples: Minimum samples to form a cluster (default: 2)
    
    Returns: {chunk_index: cluster_id}
    """
    enc = get_encoder()
    
    # Extract embeddings for each chunk
    embeddings = []
    valid_indices = []
    
    for i, path in enumerate(audio_chunk_paths):
        try:
            wav = preprocess_wav(path)
            
            # Skip very short chunks (<0.5 seconds)
            # Resemblyzer uses 16kHz sample rate
            if len(wav) < 8000:  # 16kHz * 0.5s
                logger.warning(f"Skipping chunk {i}: too short ({len(wav)/16000:.2f}s)")
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
    logger.info(f"Extracted {len(embeddings)} valid embeddings from {len(audio_chunk_paths)} chunks")
    
    # Cluster using DBSCAN (density-based clustering)
    # eps: maximum distance between samples to be considered neighbors
    # min_samples: minimum cluster size
    clustering = DBSCAN(eps=eps, min_samples=min_samples, metric='cosine')
    labels = clustering.fit_predict(embeddings)
    
    # Count noise points and valid clusters
    noise_count = sum(1 for l in labels if l == -1)
    max_cluster_id = max(labels) if len(labels) > 0 else -1
    
    logger.info(f"DBSCAN found {max_cluster_id + 1} clusters, {noise_count} noise points")
    
    # Map back to original indices
    speaker_mapping = {}
    next_noise_id = max_cluster_id + 1  # Start assigning noise points after valid clusters
    
    for valid_idx, label in zip(valid_indices, labels):
        # Handle noise points (label=-1) by assigning sequential IDs
        if label == -1:
            speaker_mapping[valid_idx] = next_noise_id
            next_noise_id += 1
        else:
            speaker_mapping[valid_idx] = int(label)
    
    # Fill in skipped chunks with nearest neighbor
    for i in range(len(audio_chunk_paths)):
        if i not in speaker_mapping:
            # Find nearest previous valid chunk
            prev_speaker = None
            for j in range(i - 1, -1, -1):
                if j in speaker_mapping:
                    prev_speaker = speaker_mapping[j]
                    break
            
            # Assign to previous speaker or create new cluster
            if prev_speaker is not None:
                speaker_mapping[i] = prev_speaker
            else:
                # No previous speaker found, assign new ID
                speaker_mapping[i] = next_noise_id
                next_noise_id += 1
    
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
    
    # Export to temp file
    # Use NamedTemporaryFile with delete=False so we can return the path
    # Caller is responsible for cleanup
    with tempfile.NamedTemporaryFile(suffix="_speaker_sample.wav", delete=False) as tmp_file:
        output_path = tmp_file.name
    
    speaker_audio.export(output_path, format="wav")
    
    final_duration = len(speaker_audio) / 1000.0
    logger.info(f"Generated speaker sample: {final_duration:.1f}s")
    
    return output_path


def compute_speaker_similarity(embed1: np.ndarray, embed2: np.ndarray) -> float:
    """Compute cosine similarity between two speaker embeddings"""
    return np.dot(embed1, embed2) / (np.linalg.norm(embed1) * np.linalg.norm(embed2))