# functions/inference/utils/audio_processor.py
import os
import subprocess
import tempfile
from typing import List, Optional
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


def time_stretch_segment(audio_path: str, target_duration: float) -> str:
    """
    Time-stretch audio file to match target duration using Rubber Band library.
    
    Rubber Band is a professional-grade pitch-preserving time stretching library
    that maintains audio quality much better than FFmpeg's atempo filter.
    
    Args:
        audio_path: Path to input audio file
        target_duration: Target duration in seconds
        
    Returns:
        Path to time-stretched audio file
    """
    import soundfile as sf
    import numpy as np
    
    # Load audio
    audio_data, sample_rate = sf.read(audio_path)
    current_duration = len(audio_data) / sample_rate
    
    # If durations are very close (within 100ms), skip stretching
    if abs(current_duration - target_duration) < 0.1:
        logger.info(f"Duration difference negligible ({abs(current_duration - target_duration):.3f}s), skipping stretch")
        return audio_path
    
    # Calculate time stretch ratio (speed rate)
    # ratio > 1 = faster (compress/shorter), ratio < 1 = slower (stretch/longer)
    time_stretch_ratio = current_duration / target_duration
    
    logger.info(f"Time-stretching segment: {current_duration:.2f}s -> {target_duration:.2f}s (speed rate: {time_stretch_ratio:.3f})")
    
    try:
        # Try using pyrubberband (high quality)
        import pyrubberband as pyrb
        
        # Ensure audio is float64 for pyrubberband
        if audio_data.dtype != np.float64:
            audio_data = audio_data.astype(np.float64)
        
        # Time stretch while preserving pitch
        stretched_audio = pyrb.time_stretch(audio_data, sample_rate, time_stretch_ratio)
        
        output_path = tempfile.mktemp(suffix="_stretched.wav")
        sf.write(output_path, stretched_audio, sample_rate)
        
        # Verify the output duration
        actual_duration = len(stretched_audio) / sample_rate
        logger.info(f"Successfully time-stretched segment using Rubber Band: {actual_duration:.2f}s (target: {target_duration:.2f}s)")
        
        return output_path
        
    except ImportError:
        logger.warning("pyrubberband not available, falling back to FFmpeg atempo (lower quality)")
        return _time_stretch_ffmpeg(audio_path, current_duration, target_duration)
    except Exception as e:
        logger.error(f"Rubber Band time-stretch failed: {e}, falling back to FFmpeg")
        return _time_stretch_ffmpeg(audio_path, current_duration, target_duration)


def _time_stretch_ffmpeg(audio_path: str, current_duration: float, target_duration: float) -> str:
    """
    Fallback time-stretching using FFmpeg atempo filter.
    Lower quality than Rubber Band but works without additional dependencies.
    """
    speed_factor = current_duration / target_duration
    
    output_path = tempfile.mktemp(suffix="_stretched.wav")
    
    # Build atempo filter chain (FFmpeg limits each atempo to 0.5-2.0 range)
    atempo_filters = []
    remaining_factor = speed_factor
    
    while remaining_factor > 2.0:
        atempo_filters.append("atempo=2.0")
        remaining_factor /= 2.0
    
    while remaining_factor < 0.5:
        atempo_filters.append("atempo=0.5")
        remaining_factor /= 0.5
    
    if abs(remaining_factor - 1.0) > 0.01:
        atempo_filters.append(f"atempo={remaining_factor}")
    
    if not atempo_filters:
        return audio_path
    
    filter_chain = ",".join(atempo_filters)
    
    cmd = [
        "ffmpeg",
        "-i", audio_path,
        "-filter:a", filter_chain,
        "-y",
        output_path
    ]
    
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
            check=True
        )
        logger.info(f"Successfully time-stretched segment using FFmpeg")
        return output_path
    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg time-stretch failed: {e.stderr.decode('utf-8')}")
        return audio_path


def concatenate_audio_files(file_paths: List[str], target_durations: Optional[List[float]] = None) -> str:
    """
    Concatenate multiple audio files using pydub with optional per-segment time-stretching.
    
    Args:
        file_paths: List of paths to audio files
        target_durations: Optional list of target durations (in seconds) for each segment.
                         If provided, each segment will be time-stretched to match before concatenation.
    
    Returns:
        Path to merged audio file
    """
    if not file_paths:
        raise ValueError("No audio files to concatenate")
    
    # Validate target_durations if provided
    if target_durations and len(target_durations) != len(file_paths):
        raise ValueError(f"Target durations count ({len(target_durations)}) must match file paths count ({len(file_paths)})")
    
    # Process each file (with optional time-stretching)
    segments = []
    temp_files_to_cleanup = []
    
    for i, path in enumerate(file_paths):
        current_path = path
        
        # Time-stretch if target duration is specified
        if target_durations and target_durations[i] is not None:
            stretched_path = time_stretch_segment(path, target_durations[i])
            if stretched_path != path:  # New file was created
                temp_files_to_cleanup.append(stretched_path)
                current_path = stretched_path
        
        # Load the audio segment
        audio = AudioSegment.from_wav(current_path)
        segments.append(audio)
    
    # Concatenate all segments
    merged = segments[0]
    for segment in segments[1:]:
        merged += segment
    
    # Export merged audio
    output_path = tempfile.mktemp(suffix="_merged.wav")
    merged.export(output_path, format="wav")
    
    # Cleanup temporary stretched files
    for temp_file in temp_files_to_cleanup:
        try:
            if os.path.exists(temp_file):
                os.remove(temp_file)
        except Exception as e:
            logger.warning(f"Failed to cleanup temp file {temp_file}: {e}")
    
    logger.info(f"Concatenated {len(file_paths)} audio files (time-stretched: {len(temp_files_to_cleanup)})")
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