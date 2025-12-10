# functions/inference/config.py
"""
Centralized configuration management with validation.
All environment variables and constants are defined here.
"""
import os
import logging

logger = logging.getLogger(__name__)


class Config:
    """Application configuration with validation"""
    
    def __init__(self):
        # Model Configuration
        self.MODEL_NAME: str = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
        self.MODEL_DIR: str = "/app/models/VibeVoice-1.5B"
        self.SAMPLE_RATE: int = 24000
        self.DEVICE: str = "cuda" if os.getenv("FORCE_CPU") != "true" else "cpu"
        
        # GCS Configuration
        self.GCS_BUCKET: str = os.getenv("GCS_BUCKET", "fennai-voice-output")
        self.GCS_DUBBING_BUCKET: str = os.getenv("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")
        
        # Cloud Run Configuration
        self.CLOUD_RUN_URL: str = os.getenv("CLOUD_RUN_URL", "")
        
        # Cloud Tasks Configuration
        self.GCP_PROJECT: str = os.getenv("GCP_PROJECT", "fennai")
        self.QUEUE_LOCATION: str = os.getenv("QUEUE_LOCATION", "us-central1")
        self.QUEUE_NAME: str = os.getenv("QUEUE_NAME", "voice-generation-queue")
        self.SERVICE_ACCOUNT_EMAIL: str = os.getenv("SERVICE_ACCOUNT_EMAIL", "")
        
        # Security
        self.INTERNAL_TOKEN: str = os.getenv("INTERNAL_TOKEN", "")
        
        # Credits Configuration
        self.SECONDS_PER_CREDIT: int = 10
        self.MULTI_CHARACTER_MULTIPLIER: float = 1.5
        self.DUBBING_TRANSLATION_MULTIPLIER: float = 1.5
        self.DUBBING_VIDEO_MULTIPLIER: float = 1.2
        self.PENDING_CREDIT_TIMEOUT_HOURS: int = 24
        
        # Timeouts (seconds)
        self.FFMPEG_TIMEOUT: int = 600
        self.STT_TIMEOUT: int = 1200
        self.TASK_DEADLINE: int = 900
        self.INFERENCE_TIMEOUT: int = 300
        self.DOWNLOAD_TIMEOUT: int = 30
        
        # Request Limits
        self.MAX_PAYLOAD_SIZE: int = 10 * 1024 * 1024  # 10MB
        self.MAX_TEXT_LENGTH: int = 100000
        self.MAX_VOICE_SAMPLES: int = 20
        self.MAX_CHUNKS: int = 100
        
        # Audio Processing Constants
        self.NORMALIZATION_HEADROOM: float = 0.95
        self.TRIM_DB_THRESHOLD: int = 40
        self.MIN_CHUNK_SAMPLES: int = 8000  # 0.5s at 16kHz
        self.SPEAKER_SAMPLE_TARGET_DURATION: float = 15.0
        self.SPEAKER_SAMPLE_MIN_DURATION: float = 2.0
        
        # Speaker Clustering Constants
        self.DBSCAN_EPS: float = 0.15
        self.DBSCAN_MIN_SAMPLES: int = 2
        self.DBSCAN_METRIC: str = 'cosine'
        self.MIN_SPEAKER_COUNT: int = 1
        self.MAX_SPEAKER_COUNT: int = 10
        
        # Performance
        self.PARALLEL_DOWNLOAD_WORKERS: int = 5
        self.MODEL_COMPILE_MODE: str = "reduce-overhead"
        self.DDPM_INFERENCE_STEPS: int = 10
        
        # Logging
        self.LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
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
