# download_model.py
import os
from pathlib import Path
from huggingface_hub import snapshot_download
import logging

logger = logging.getLogger(__name__)

MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/models"))
TARGET_DIR = CACHE_DIR / "VibeVoice-1.5B"

def download_if_missing() -> str:
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    
    # DEFINITIVE FIX: Check for a specific marker file, not just config.json
    completion_marker = TARGET_DIR / ".download_complete"

    if completion_marker.exists():
        logger.info(f"Model verified and present at {TARGET_DIR}")
        return str(TARGET_DIR)

    logger.info(f"Downloading {MODEL_NAME} to {TARGET_DIR}...")

    try:
        snapshot_download(
            repo_id=MODEL_NAME,
            local_dir=TARGET_DIR,
            local_dir_use_symlinks=False,
            resume_download=True, # crucial: will pick up where it left off
            token=os.getenv("HF_TOKEN"),
            ignore_patterns=["*.msgpack", "*.h5"],
        )
        
        # Only write this file if the download completes without error
        completion_marker.touch() 
        logger.info(f"Model successfully downloaded and marked complete.")
        
    except Exception as e:
        logger.error(f"Download failed: {e}")
        # Optional: remove the marker if it exists to force retry next time
        if completion_marker.exists():
            completion_marker.unlink()
        raise e

    return str(TARGET_DIR)