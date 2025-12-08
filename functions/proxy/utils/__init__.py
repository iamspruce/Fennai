# functions/proxy/utils/__init__.py
"""
Shared utilities, constants, and helper functions for the voice cloning system.
"""
import logging
import os
import tempfile
from typing import Optional, Dict, Any, List, Tuple
from google.cloud import storage

logger = logging.getLogger(__name__)

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
        """
        Initialize GCS helper.
        
        Args:
            bucket_name: Name of the GCS bucket
        """
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket_name)
        self.bucket_name = bucket_name
    
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
        for attempt in range(GCS_RETRY_CONFIG['max_attempts']):
            try:
                blob = self.bucket.blob(remote_path)
                blob.upload_from_filename(local_path, content_type=content_type)
                logger.info(f"Uploaded {local_path} to gs://{self.bucket_name}/{remote_path}")
                return True, None
            except Exception as e:
                logger.warning(f"Upload attempt {attempt + 1} failed: {str(e)}")
                if attempt == GCS_RETRY_CONFIG['max_attempts'] - 1:
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
        
        for attempt in range(GCS_RETRY_CONFIG['max_attempts']):
            try:
                blob = self.bucket.blob(remote_path)
                blob.download_to_filename(local_path)
                logger.info(f"Downloaded gs://{self.bucket_name}/{remote_path} to {local_path}")
                return True, local_path, None
            except Exception as e:
                logger.warning(f"Download attempt {attempt + 1} failed: {str(e)}")
                if attempt == GCS_RETRY_CONFIG['max_attempts'] - 1:
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
            blob = self.bucket.blob(remote_path)
            blob.delete()
            logger.info(f"Deleted gs://{self.bucket_name}/{remote_path}")
            return True, None
        except Exception as e:
            logger.error(f"Failed to delete {remote_path}: {str(e)}")
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
        return False, f"File size ({size_mb:.1f}MB) exceeds limit of {max_size_mb}MB"
    return True, None


def validate_duration(duration_seconds: float, max_duration: float) -> Tuple[bool, Optional[str]]:
    """
    Validate duration against limit.
    
    Args:
        duration_seconds: Duration in seconds
        max_duration: Maximum allowed duration
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    if duration_seconds > max_duration:
        return False, f"Duration ({duration_seconds:.1f}s) exceeds limit of {max_duration}s"
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