# functions/inference/utils/audio_processor.py
import os
import subprocess
import tempfile
from typing import List
from pydub import AudioSegment
import logging

logger = logging.getLogger(__name__)


def extract_audio_from_video(video_path: str) -> str:
    """
    Extract audio from video file using FFmpeg
    Returns path to extracted WAV file
    """
    output_path = tempfile.mktemp(suffix=".wav")
    
    cmd = [
        "ffmpeg",
        "-i", video_path,
        "-vn",  # No video
        "-acodec", "pcm_s16le",  # PCM 16-bit
        "-ar", "24000",  # 24kHz sample rate
        "-ac", "1",  # Mono
        "-y",  # Overwrite
        output_path
    ]
    
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=300
    )
    
    if result.returncode != 0:
        error_msg = result.stderr.decode('utf-8')
        raise RuntimeError(f"FFmpeg audio extraction failed: {error_msg}")
    
    logger.info(f"Extracted audio from video: {output_path}")
    return output_path


def split_audio_by_timestamps(audio_path: str, segments: List[dict]) -> List[str]:
    """
    Split audio file into chunks based on transcript segments
    Returns list of paths to chunk files
    """
    audio = AudioSegment.from_wav(audio_path)
    chunk_paths = []
    
    for i, segment in enumerate(segments):
        start_ms = int(segment["startTime"] * 1000)
        end_ms = int(segment["endTime"] * 1000)
        
        chunk = audio[start_ms:end_ms]
        
        chunk_path = tempfile.mktemp(suffix=f"_chunk_{i}.wav")
        chunk.export(chunk_path, format="wav")
        chunk_paths.append(chunk_path)
    
    return chunk_paths


def concatenate_audio_files(file_paths: List[str]) -> str:
    """
    Concatenate multiple audio files using pydub
    Returns path to merged audio file
    """
    if not file_paths:
        raise ValueError("No audio files to concatenate")
    
    # Load first file
    merged = AudioSegment.from_wav(file_paths[0])
    
    # Append remaining files
    for path in file_paths[1:]:
        audio = AudioSegment.from_wav(path)
        merged += audio
    
    # Export merged audio
    output_path = tempfile.mktemp(suffix="_merged.wav")
    merged.export(output_path, format="wav")
    
    logger.info(f"Concatenated {len(file_paths)} audio files")
    return output_path


def get_audio_duration(file_path: str) -> float:
    """Get duration of audio file in seconds"""
    audio = AudioSegment.from_file(file_path)
    return len(audio) / 1000.0  # Convert ms to seconds


def normalize_audio(file_path: str) -> str:
    """Normalize audio levels"""
    audio = AudioSegment.from_wav(file_path)
    
    # Normalize to -3dB headroom
    normalized = audio.normalize(headroom=3.0)
    
    output_path = tempfile.mktemp(suffix="_normalized.wav")
    normalized.export(output_path, format="wav")
    
    return output_path