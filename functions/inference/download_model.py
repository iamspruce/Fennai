# download_model.py
import os
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/models"))
TARGET_DIR = CACHE_DIR / "VibeVoice-1.5B"

def download_if_missing() -> str:
    """
    Verifies model exists in mounted bucket.
    Model should be pre-downloaded during deployment.
    
    HuggingFace's snapshot_download with local_dir creates a 
    .cache/huggingface/ subfolder to track completion.
    """
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    
    # Check for HuggingFace's own metadata (indicates successful download)
    hf_cache = TARGET_DIR / ".cache" / "huggingface"
    config_file = TARGET_DIR / "config.json"
    
    if hf_cache.exists() and config_file.exists():
        logger.info(f"✓ Model present at {TARGET_DIR} (HuggingFace metadata found)")
        return str(TARGET_DIR)
    
    if config_file.exists():
        logger.warning("⚠️ Model files exist but no HuggingFace metadata")
        logger.warning("Model may be incomplete - attempting to use anyway")
        return str(TARGET_DIR)
    
    # Model not found
    logger.error(f"❌ Model not found at {TARGET_DIR}")
    logger.error("Model should be pre-downloaded to bucket during deployment")
    logger.error(f"Expected path: gs://fennai-vibevoice-models/VibeVoice-1.5B")
    
    raise RuntimeError(
        f"Model not found at {TARGET_DIR}. "
        "Ensure deployment completed successfully and model was uploaded to bucket."
    )

    return str(TARGET_DIR)