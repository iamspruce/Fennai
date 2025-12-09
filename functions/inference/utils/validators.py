# functions/inference/utils/validators.py
"""
Input validation using Pydantic models.
Ensures type safety and validates constraints before processing.
"""
from typing import Optional, List, Dict
from pydantic import BaseModel, Field, field_validator, ValidationError
import logging

from config import config

logger = logging.getLogger(__name__)


class InferenceRequest(BaseModel):
    """Validation model for inference requests"""
    
    job_id: str = Field(..., min_length=1, max_length=100)
    uid: str = Field(..., min_length=1, max_length=100)
    text: str = Field(..., min_length=1, max_length=config.MAX_TEXT_LENGTH)
    voice_samples: List[str] = Field(..., min_length=1, max_length=config.MAX_VOICE_SAMPLES)
    cost: int = Field(..., ge=1, le=1000)
    chunk_id: Optional[int] = Field(None, ge=0)
    total_chunks: int = Field(1, ge=1, le=config.MAX_CHUNKS)
    
    @field_validator('text')
    @classmethod
    def validate_text(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('Text cannot be empty')
        return v
    
    @field_validator('voice_samples')
    @classmethod
    def validate_voice_samples(cls, v):
        if not v:
            raise ValueError('At least one voice sample required')
        return v
    
    class Config:
        # Allow extra fields but don't include them
        extra = 'ignore'


class ExtractAudioRequest(BaseModel):
    """Validation model for audio extraction requests"""
    
    job_id: str = Field(..., min_length=1, max_length=100)
    uid: str = Field(..., min_length=1, max_length=100)
    media_path: str = Field(..., min_length=1)
    media_type: str = Field("audio", pattern="^(audio|video)$")
    
    class Config:
        extra = 'ignore'


class ClusterSpeakersRequest(BaseModel):
    """Validation model for speaker clustering requests"""
    
    job_id: str = Field(..., min_length=1, max_length=100)
    uid: str = Field(..., min_length=1, max_length=100)
    audio_path: str = Field(..., min_length=1)
    
    class Config:
        extra = 'ignore'


class CloneAudioRequest(BaseModel):
    """Validation model for audio cloning requests"""
    
    job_id: str = Field(..., min_length=1, max_length=100)
    uid: str = Field(..., min_length=1, max_length=100)
    chunk_id: int = Field(..., ge=0)
    speakers: List[str] = Field(..., min_length=1, max_length=4)
    text: str = Field(..., min_length=1)
    voice_samples: Dict[str, str] = Field(..., min_length=1)
    
    @field_validator('voice_samples')
    @classmethod
    def validate_voice_samples(cls, v, info):
        speakers = info.data.get('speakers', [])
        missing = [s for s in speakers if s not in v]
        if missing:
            raise ValueError(f'Missing voice samples for speakers: {missing}')
        return v
    
    class Config:
        extra = 'ignore'


class MergeRequest(BaseModel):
    """Validation model for merge requests (audio/video)"""
    
    job_id: str = Field(..., min_length=1, max_length=100)
    uid: str = Field(..., min_length=1, max_length=100)
    
    class Config:
        extra = 'ignore'


def validate_request(model_class: type[BaseModel], data: dict) -> BaseModel:
    """
    Validate request data against a Pydantic model.
    
    Args:
        model_class: Pydantic model class
        data: Request data to validate
    
    Returns:
        Validated model instance
    
    Raises:
        ValidationError: If validation fails
    
    Usage:
        try:
            req = validate_request(InferenceRequest, request.get_json())
            job_id = req.job_id
        except ValidationError as e:
            return jsonify({"error": e.errors()}), 400
    """
    try:
        return model_class(**data)
    except ValidationError as e:
        logger.warning(f"Validation failed: {e.errors()}")
        raise


def validate_audio_format(file_path: str) -> bool:
    """
    Validate audio file format.
    
    Args:
        file_path: Path to audio file
    
    Returns:
        True if valid audio format
    """
    import soundfile as sf
    
    try:
        info = sf.info(file_path)
        return info.samplerate > 0 and info.channels in [1, 2]
    except Exception as e:
        logger.error(f"Invalid audio format: {e}")
        return False


def validate_video_format(file_path: str) -> bool:
    """
    Validate video file format using ffprobe.
    
    Args:
        file_path: Path to video file
    
    Returns:
        True if valid video format
    """
    import subprocess
    
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", file_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10
        )
        return result.returncode == 0
    except Exception as e:
        logger.error(f"Invalid video format: {e}")
        return False


def validate_transcript(transcript: List[dict]) -> bool:
    """
    Validate transcript format.
    
    Args:
        transcript: List of transcript segments
    
    Returns:
        True if valid transcript format
    """
    if not transcript or not isinstance(transcript, list):
        return False
    
    required_fields = {'text', 'startTime', 'endTime'}
    
    for segment in transcript:
        if not isinstance(segment, dict):
            return False
        
        if not required_fields.issubset(segment.keys()):
            return False
        
        # Validate time ordering
        if segment['startTime'] >= segment['endTime']:
            return False
    
    return True