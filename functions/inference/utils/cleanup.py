# functions/inference/utils/cleanup.py
"""
Resource cleanup utilities to prevent memory leaks.
Implements context managers for temporary files and cleanup handlers.
"""
import os
import tempfile
import logging
from contextlib import contextmanager
from typing import Generator, List, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


@contextmanager
def temp_file(suffix: str = "", prefix: str = "tmp") -> Generator[str, None, None]:
    """
    Context manager for temporary files with guaranteed cleanup.
    
    Usage:
        with temp_file(".wav") as path:
            # Use the file
            audio.export(path, format="wav")
        # File is automatically deleted
    
    Args:
        suffix: File extension (e.g., ".wav", ".mp4")
        prefix: File prefix
    
    Yields:
        str: Path to temporary file
    """
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=prefix)
    tmp_path = tmp.name
    tmp.close()
    
    try:
        yield tmp_path
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                logger.debug(f"Cleaned up temp file: {tmp_path}")
        except Exception as e:
            logger.warning(f"Failed to cleanup temp file {tmp_path}: {e}")


@contextmanager
def temp_files(count: int, suffix: str = "", prefix: str = "tmp") -> Generator[List[str], None, None]:
    """
    Context manager for multiple temporary files.
    
    Usage:
        with temp_files(3, ".wav") as paths:
            for i, path in enumerate(paths):
                # Use each file
                pass
        # All files automatically deleted
    
    Args:
        count: Number of temporary files to create
        suffix: File extension
        prefix: File prefix
    
    Yields:
        List[str]: List of temporary file paths
    """
    tmp_paths = []
    
    try:
        for _ in range(count):
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=prefix)
            tmp_paths.append(tmp.name)
            tmp.close()
        
        yield tmp_paths
    finally:
        for tmp_path in tmp_paths:
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                    logger.debug(f"Cleaned up temp file: {tmp_path}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temp file {tmp_path}: {e}")


class TempFileManager:
    """
    Manages multiple temporary files with automatic cleanup.
    Useful for operations that create many temp files dynamically.
    
    Usage:
        manager = TempFileManager()
        path1 = manager.create(".wav")
        path2 = manager.create(".mp4")
        # ... use files ...
        manager.cleanup_all()  # Or let it cleanup on __del__
    """
    
    def __init__(self):
        self.temp_files: List[str] = []
    
    def create(self, suffix: str = "", prefix: str = "tmp") -> str:
        """Create a temporary file and track it for cleanup"""
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=prefix)
        tmp_path = tmp.name
        tmp.close()
        self.temp_files.append(tmp_path)
        return tmp_path
    
    def cleanup(self, path: str) -> None:
        """Clean up a specific temporary file"""
        try:
            if os.path.exists(path):
                os.unlink(path)
                logger.debug(f"Cleaned up temp file: {path}")
            if path in self.temp_files:
                self.temp_files.remove(path)
        except Exception as e:
            logger.warning(f"Failed to cleanup temp file {path}: {e}")
    
    def cleanup_all(self) -> None:
        """Clean up all tracked temporary files"""
        for path in self.temp_files[:]:  # Copy list to avoid modification during iteration
            self.cleanup(path)
    
    def __del__(self):
        """Cleanup on garbage collection"""
        self.cleanup_all()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup_all()


def cleanup_old_temp_files(pattern: str = "tmp*.wav", max_age_hours: int = 24) -> int:
    """
    Cleanup old temporary files that weren't properly cleaned up.
    Should be called periodically by a cleanup job.
    
    Args:
        pattern: Glob pattern for temp files
        max_age_hours: Delete files older than this
    
    Returns:
        int: Number of files deleted
    """
    import time
    from glob import glob
    
    temp_dir = tempfile.gettempdir()
    pattern_path = os.path.join(temp_dir, pattern)
    
    deleted_count = 0
    current_time = time.time()
    max_age_seconds = max_age_hours * 3600
    
    for file_path in glob(pattern_path):
        try:
            file_age = current_time - os.path.getmtime(file_path)
            if file_age > max_age_seconds:
                os.unlink(file_path)
                deleted_count += 1
                logger.debug(f"Cleaned up old temp file: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to cleanup old temp file {file_path}: {e}")
    
    if deleted_count > 0:
        logger.info(f"Cleaned up {deleted_count} old temporary files")
    
    return deleted_count