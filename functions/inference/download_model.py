import os
import time
import shutil
from pathlib import Path
from huggingface_hub import snapshot_download
import logging
import traceback  # For full stack traces

logger = logging.getLogger(__name__)  

MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")

CACHE_DIR = Path("/workspace/models")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

LOCK_FILE = CACHE_DIR / ".download.lock"


def wait_for_unlock():
    """If another instance is downloading, wait."""
    while LOCK_FILE.exists():
        logger.info("Another instance is downloading the model... waiting...")  # Changed to logger
        time.sleep(3)


def validate_model_cache(model_path):
    """
    Validate that the cached model is complete.
    Returns True if valid, False if incomplete/corrupted.
    """
    if not model_path.exists():
        return False
    
    # Check for snapshot directory
    snapshot_dir = model_path / "snapshots"
    if not snapshot_dir.exists():
        return False
    
    # Check that snapshot directory has contents
    snapshot_contents = list(snapshot_dir.iterdir())
    if not snapshot_contents:
        logger.warning(f"Snapshot directory empty at {snapshot_dir}")  # Changed to logger
        return False
    
    # Check for essential model files in the snapshot
    # Look for at least one snapshot subdirectory
    for item in snapshot_contents:
        if item.is_dir():
            essential_files = ["config.json", "model.safetensors.index.json"]
            has_essential = any((item / f).exists() for f in essential_files)
            if has_essential:
                return True
    
    logger.warning(f"No valid model files found in {snapshot_dir}")  # Changed to logger
    return False


def download_if_missing():
    # Hugging Face manages naming inside cache_dir
    expected_dir_prefix = f"models--{MODEL_NAME.replace('/', '--')}"
    model_folders = list(CACHE_DIR.glob(expected_dir_prefix + "*"))

    if model_folders:
        model_path = model_folders[0]
        
        # Validate the cached model
        if validate_model_cache(model_path):
            logger.info(f"Valid model found in cache: {model_path}")  # Changed to logger
            return model_path
        else:
            logger.warning(f"Incomplete model cache found at {model_path}, removing and re-downloading...")  # Changed to logger
            try:
                shutil.rmtree(model_path)
            except Exception as e:
                logger.warning(f"Could not remove incomplete cache: {e}")  # Changed to logger

    # Prevent multiple parallel downloads
    if LOCK_FILE.exists():
        wait_for_unlock()
        return download_if_missing()

    try:
        # Create lock
        LOCK_FILE.touch()

        logger.info(f"Downloading model: {MODEL_NAME} ...")  # Changed to logger
        logger.info(f"Cache directory: {CACHE_DIR}")  # Changed to logger

        path = snapshot_download(
            repo_id=MODEL_NAME,
            cache_dir=str(CACHE_DIR),
            local_dir_use_symlinks=False,
            resume_download=True,
            token=os.getenv("HF_TOKEN"),  # None is fine since not gated
        )

        logger.info(f"✓ Model download complete: {path}")  # Changed to logger
        
        # Validate the downloaded model
        downloaded_path = Path(path).parent.parent.parent  # Go up to the cache root for this model
        if validate_model_cache(downloaded_path):
            logger.info("✓ Model validation successful")  # Changed to logger
        else:
            logger.warning("Downloaded model may be incomplete")  # Changed to logger
        
        return path

    except Exception as e:
        logger.error(f"Download failed: {e}")  # Changed to logger.error
        logger.error(traceback.format_exc())  # ← ADD: Full stack trace in logs
        logger.info("Model will try to download again on next request.")  # Changed to logger
        # Do NOT raise—keeps Cloud Run alive
        return None

    finally:
        # Always clean lock on exit
        if LOCK_FILE.exists():
            LOCK_FILE.unlink()


if __name__ == "__main__":
    result = download_if_missing()
    if result:
        logger.info(f"✓ Model ready at: {result}")  # Changed to logger
    else:
        logger.warning("✗ Model download failed")  # Changed to logger