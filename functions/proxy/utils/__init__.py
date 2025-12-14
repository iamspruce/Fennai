# functions/proxy/utils/__init__.py
"""
Shared utilities, constants, and helper functions for the voice cloning system.
"""
import logging
import sys
import os
import tempfile
from typing import Optional, Dict, Any, List, Tuple
from google.cloud import storage

# ✅ Configure logging for Cloud Functions immediately
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: [%(name)s] %(message)s',
    stream=sys.stdout,
    force=True
)

logger = logging.getLogger(__name__)

# ✅ Force logger to use stdout and set level
logger.setLevel(logging.INFO)
logger.propagate = True

# Log module initialization
print("utils/__init__.py loaded")
logger.info("Utils module initialized")

# API Constants
MAX_TEXT_LENGTH = 50000
MAX_VOICE_SAMPLES = 20
MAX_SPEAKERS_PER_CHUNK = 4
SECONDS_PER_SPEAKER_ESTIMATE = 15
MAX_FILE_SIZE_MB = 500

# Credit System Constants
SECONDS_PER_CREDIT = 10
MULTI_CHARACTER_MULTIPLIER = 1.5
DUBBING_TRANSLATION_MULTIPLIER = 1.5
DUBBING_VIDEO_MULTIPLIER = 1.2
PENDING_CREDIT_TIMEOUT_HOURS = 24

# Tier Limits
SPEAKER_LIMITS = {
    'free': 4,
    'pro': 12,
    'enterprise': float('inf')
}

UPLOAD_LIMITS = {
    'free': {'maxDurationSeconds': 120, 'maxFileSizeMB': 100},
    'pro': {'maxDurationSeconds': 1800, 'maxFileSizeMB': 2048},
    'enterprise': {'maxDurationSeconds': float('inf'), 'maxFileSizeMB': float('inf')}
}

# GCS Configuration
GCS_RETRY_CONFIG = {
    'max_attempts': 3,
    'initial_delay': 1.0,
    'max_delay': 10.0,
    'multiplier': 2.0
}


class GCSHelper:
    """Helper class for Google Cloud Storage operations with retry logic."""
    
    def __init__(self, bucket_name: str):
        """Initialize GCS helper with lazy client creation."""
        self.bucket_name = bucket_name
        self._client = None
        self._bucket = None
        logger.info(f"GCSHelper initialized for bucket: {bucket_name}")
    
    @property
    def client(self):
        """Lazy-load storage client."""
        if self._client is None:
            logger.info("Creating GCS storage client...")
            self._client = storage.Client()
        return self._client
    
    @property
    def bucket(self):
        """Lazy-load bucket."""
        if self._bucket is None:
            logger.info(f"Getting bucket: {self.bucket_name}")
            self._bucket = self.client.bucket(self.bucket_name)
        return self._bucket
    
    def upload_file(
        self, 
        local_path: str, 
        remote_path: str, 
        content_type: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Upload file to GCS with retry logic.
        
        Args:
            local_path: Local file path
            remote_path: Remote GCS path
            content_type: MIME type
            
        Returns:
            Tuple of (success, error_message)
        """
        logger.info(f"Uploading {local_path} to gs://{self.bucket_name}/{remote_path}")
        
        for attempt in range(GCS_RETRY_CONFIG['max_attempts']):
            try:
                blob = self.bucket.blob(remote_path)
                blob.upload_from_filename(local_path, content_type=content_type)
                logger.info(f"✓ Upload successful: gs://{self.bucket_name}/{remote_path}")
                return True, None
            except Exception as e:
                logger.warning(f"Upload attempt {attempt + 1}/{GCS_RETRY_CONFIG['max_attempts']} failed: {str(e)}")
                if attempt == GCS_RETRY_CONFIG['max_attempts'] - 1:
                    logger.error(f"✗ Upload failed after {GCS_RETRY_CONFIG['max_attempts']} attempts")
                    return False, str(e)
        
        return False, "Max retry attempts exceeded"
    
    def download_file(
        self, 
        remote_path: str, 
        local_path: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Download file from GCS with retry logic.
        
        Args:
            remote_path: Remote GCS path
            local_path: Local file path (creates temp file if None)
            
        Returns:
            Tuple of (success, local_path, error_message)
        """
        if local_path is None:
            suffix = os.path.splitext(remote_path)[1]
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                local_path = tmp.name
        
        logger.info(f"Downloading gs://{self.bucket_name}/{remote_path} to {local_path}")
        
        for attempt in range(GCS_RETRY_CONFIG['max_attempts']):
            try:
                blob = self.bucket.blob(remote_path)
                blob.download_to_filename(local_path)
                logger.info(f"✓ Download successful: {local_path}")
                return True, local_path, None
            except Exception as e:
                logger.warning(f"Download attempt {attempt + 1}/{GCS_RETRY_CONFIG['max_attempts']} failed: {str(e)}")
                if attempt == GCS_RETRY_CONFIG['max_attempts'] - 1:
                    logger.error(f"✗ Download failed after {GCS_RETRY_CONFIG['max_attempts']} attempts")
                    return False, None, str(e)
        
        return False, None, "Max retry attempts exceeded"
    
    def delete_file(self, remote_path: str) -> Tuple[bool, Optional[str]]:
        """
        Delete file from GCS.
        
        Args:
            remote_path: Remote GCS path
            
        Returns:
            Tuple of (success, error_message)
        """
        try:
            logger.info(f"Deleting gs://{self.bucket_name}/{remote_path}")
            blob = self.bucket.blob(remote_path)
            blob.delete()
            logger.info(f"✓ Delete successful: gs://{self.bucket_name}/{remote_path}")
            return True, None
        except Exception as e:
            logger.error(f"✗ Failed to delete {remote_path}: {str(e)}")
            return False, str(e)


class ResponseBuilder:
    """Helper class for building standardized API responses."""
    
    @staticmethod
    def success(
        data: Any, 
        status: int = 200, 
        request_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Build success response.
        
        Args:
            data: Response data
            status: HTTP status code
            request_id: Optional request ID
            
        Returns:
            Response dictionary
        """
        response = {
            "success": True,
            "data": data
        }
        if request_id:
            response["requestId"] = request_id
        
        # ✅ Log response building
        logger.debug(f"Building success response: status={status}, request_id={request_id}")
        
        return response
    
    @staticmethod
    def error(
        message: str, 
        status: int = 400, 
        details: Optional[Any] = None,
        request_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Build error response.
        
        Args:
            message: Error message
            status: HTTP status code
            details: Optional error details
            request_id: Optional request ID
            
        Returns:
            Response dictionary
        """
        response = {
            "success": False,
            "error": message
        }
        if details:
            response["details"] = details
        if request_id:
            response["requestId"] = request_id
        
        # ✅ Log error response building
        logger.warning(f"Building error response: {message} (status={status}, request_id={request_id})")
        
        return response


def validate_file_size(size_bytes: int, max_size_mb: int) -> Tuple[bool, Optional[str]]:
    """
    Validate file size against limit.
    
    Args:
        size_bytes: File size in bytes
        max_size_mb: Maximum allowed size in MB
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    size_mb = size_bytes / (1024 * 1024)
    
    if size_mb > max_size_mb:
        error_msg = f"File size ({size_mb:.1f}MB) exceeds limit of {max_size_mb}MB"
        logger.warning(f"File size validation failed: {error_msg}")
        return False, error_msg
    
    logger.debug(f"File size validation passed: {size_mb:.1f}MB <= {max_size_mb}MB")
    return True, None


def validate_duration(duration_seconds: float, max_duration: float) -> Tuple[bool, Optional[str]]:
    """
    Validate duration against limit.
    
    Args:
        duration_seconds: Duration in seconds
        max_duration: Maximum allowed duration (can be float('inf') for unlimited)
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    # ✅ Handle unlimited duration for enterprise tier
    if max_duration == float('inf'):
        logger.debug(f"Duration validation passed: {duration_seconds}s (unlimited)")
        return True, None
    
    if duration_seconds > max_duration:
        error_msg = f"Duration ({duration_seconds:.1f}s) exceeds limit of {max_duration}s"
        logger.warning(f"Duration validation failed: {error_msg}")
        return False, error_msg
    
    logger.debug(f"Duration validation passed: {duration_seconds:.1f}s <= {max_duration}s")
    return True, None

def cleanup_temp_files(file_paths: List[str]):
    """
    Clean up temporary files.
    
    Args:
        file_paths: List of file paths to delete
    """
    for path in file_paths:
        try:
            if os.path.exists(path):
                os.unlink(path)
                logger.debug(f"Cleaned up temp file: {path}")
        except Exception as e:
            logger.warning(f"Failed to cleanup {path}: {str(e)}")


def format_duration(seconds: float) -> str:
    """
    Format duration in human-readable format.
    
    Args:
        seconds: Duration in seconds
        
    Returns:
        Formatted string (e.g., "1m 30s")
    """
    if seconds < 60:
        return f"{int(seconds)}s"
    
    minutes = int(seconds // 60)
    remaining_seconds = int(seconds % 60)
    
    if minutes < 60:
        return f"{minutes}m {remaining_seconds}s"
    
    hours = minutes // 60
    remaining_minutes = minutes % 60
    return f"{hours}h {remaining_minutes}m"


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent path traversal and invalid characters.
    
    Args:
        filename: Original filename
        
    Returns:
        Sanitized filename
    """
    original = filename
    
    # Remove path separators
    filename = filename.replace('/', '_').replace('\\', '_')
    
    # Remove potentially dangerous characters
    dangerous_chars = '<>:"|?*'
    for char in dangerous_chars:
        filename = filename.replace(char, '_')
    
    # Limit length
    if len(filename) > 255:
        name, ext = os.path.splitext(filename)
        filename = name[:255-len(ext)] + ext
    
    if filename != original:
        logger.debug(f"Sanitized filename: '{original}' -> '{filename}'")
    
    return filename


# Export all utilities
__all__ = [
    # Constants
    'MAX_TEXT_LENGTH',
    'MAX_VOICE_SAMPLES',
    'MAX_SPEAKERS_PER_CHUNK',
    'SECONDS_PER_SPEAKER_ESTIMATE',
    'MAX_FILE_SIZE_MB',
    'SECONDS_PER_CREDIT',
    'MULTI_CHARACTER_MULTIPLIER',
    'DUBBING_TRANSLATION_MULTIPLIER',
    'DUBBING_VIDEO_MULTIPLIER',
    'PENDING_CREDIT_TIMEOUT_HOURS',
    'SPEAKER_LIMITS',
    'UPLOAD_LIMITS',
    'GCS_RETRY_CONFIG',
    
    # Classes
    'GCSHelper',
    'ResponseBuilder',
    
    # Functions
    'validate_file_size',
    'validate_duration',
    'cleanup_temp_files',
    'format_duration',
    'sanitize_filename',
]