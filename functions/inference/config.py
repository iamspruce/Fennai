# functions/inference/config.py
"""
Centralized configuration management with validation.
All environment variables and constants are defined here.
"""
from dataclasses import dataclass
from typing import Optional
import os
import logging

logger = logging.getLogger(__name__)


@dataclass
class Config:
    """Application configuration with validation"""
    
    # Model Configuration
    MODEL_NAME: str = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
    MODEL_DIR: str = "/app/models/VibeVoice-1.5B"
    SAMPLE_RATE: int = 24000
    DEVICE: str = "cuda" if os.getenv("FORCE_CPU") != "true" else "cpu"
    
    # GCS Configuration
    GCS_BUCKET: str = os.getenv("GCS_BUCKET", "fennai-voice-output")
    GCS_DUBBING_BUCKET: str = os.getenv("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")
    
    # Cloud Run Configuration
    CLOUD_RUN_URL: str = os.getenv("CLOUD_RUN_URL", "")
    
    # Cloud Tasks Configuration
    GCP_PROJECT: str = os.getenv("GCP_PROJECT", "fennai")
    QUEUE_LOCATION: str = os.getenv("QUEUE_LOCATION", "us-central1")
    QUEUE_NAME: str = os.getenv("QUEUE_NAME", "voice-generation-queue")
    SERVICE_ACCOUNT_EMAIL: str = os.getenv("SERVICE_ACCOUNT_EMAIL", "")
    
    # Security
    INTERNAL_TOKEN: str = os.getenv("INTERNAL_TOKEN", "")
    
    # Credits Configuration
    SECONDS_PER_CREDIT: int = 10
    MULTI_CHARACTER_MULTIPLIER: float = 1.5
    DUBBING_TRANSLATION_MULTIPLIER: float = 1.5
    DUBBING_VIDEO_MULTIPLIER: float = 1.2
    PENDING_CREDIT_TIMEOUT_HOURS: int = 24
    
    # Timeouts (seconds)
    FFMPEG_TIMEOUT: int = 600
    STT_TIMEOUT: int = 1200
    TASK_DEADLINE: int = 900
    INFERENCE_TIMEOUT: int = 300
    DOWNLOAD_TIMEOUT: int = 30
    
    # Request Limits
    MAX_PAYLOAD_SIZE: int = 10 * 1024 * 1024  # 10MB
    MAX_TEXT_LENGTH: int = 100000
    MAX_VOICE_SAMPLES: int = 20
    MAX_CHUNKS: int = 100
    
    # Audio Processing Constants
    NORMALIZATION_HEADROOM: float = 0.95
    TRIM_DB_THRESHOLD: int = 40
    MIN_CHUNK_SAMPLES: int = 8000  # 0.5s at 16kHz
    SPEAKER_SAMPLE_TARGET_DURATION: float = 15.0
    SPEAKER_SAMPLE_MIN_DURATION: float = 2.0
    
    # Speaker Clustering Constants
    DBSCAN_EPS: float = 0.15
    DBSCAN_MIN_SAMPLES: int = 2
    DBSCAN_METRIC: str = 'cosine'
    MIN_SPEAKER_COUNT: int = 1
    MAX_SPEAKER_COUNT: int = 10
    
    # Performance
    PARALLEL_DOWNLOAD_WORKERS: int = 5
    MODEL_COMPILE_MODE: str = "reduce-overhead"
    DDPM_INFERENCE_STEPS: int = 10
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
    def validate(self) -> None:
        """Validate required configuration at startup"""
        errors = []
        
        if not self.INTERNAL_TOKEN:
            errors.append("INTERNAL_TOKEN environment variable not set")
        
        if not self.CLOUD_RUN_URL:
            errors.append("CLOUD_RUN_URL environment variable not set")
        
        if not self.GCP_PROJECT:
            errors.append("GCP_PROJECT environment variable not set")
        
        if errors:
            error_msg = "Configuration validation failed:\n" + "\n".join(f"  - {e}" for e in errors)
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        logger.info("Configuration validation passed")
    
    def log_config(self) -> None:
        """Log non-sensitive configuration for debugging"""
        logger.info("=== Configuration ===")
        logger.info(f"Model: {self.MODEL_NAME}")
        logger.info(f"Device: {self.DEVICE}")
        logger.info(f"Sample Rate: {self.SAMPLE_RATE}Hz")
        logger.info(f"GCS Bucket: {self.GCS_BUCKET}")
        logger.info(f"Project: {self.GCP_PROJECT}")
        logger.info(f"Queue: {self.QUEUE_NAME}")
        logger.info("=" * 50)


# Global configuration instance
config = Config()