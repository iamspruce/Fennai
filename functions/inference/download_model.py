# functions/inference/download_model.py
import os
from pathlib import Path
from huggingface_hub import snapshot_download
import logging

logger = logging.getLogger(__name__)

MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/models"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def download_if_missing() -> str:
    """
    Download model to persistent storage if not present.
    Returns the path to the model directory.
    
    Uses cache_dir (not local_dir) to leverage HF's caching system.
    """
    # Check if model already exists in cache
    # HF cache structure: CACHE_DIR/models--org--name/snapshots/hash/
    model_cache_name = MODEL_NAME.replace("/", "--")
    model_cache_path = CACHE_DIR / f"models--{model_cache_name}"
    snapshots_dir = model_cache_path / "snapshots"
    
    # Check if model is already downloaded
    if snapshots_dir.exists():
        # Find the snapshot directory (there should be one)
        snapshot_dirs = list(snapshots_dir.iterdir())
        if snapshot_dirs:
            snapshot_dir = snapshot_dirs[0]
            # Verify it's complete by checking for config.json
            if (snapshot_dir / "config.json").exists():
                logger.info(f"✓ Model already cached at {snapshot_dir}")
                return str(snapshot_dir)
            else:
                logger.warning(f"Incomplete model cache found at {snapshot_dir}, re-downloading...")
    
    # Model not found or incomplete - download it
    logger.info(f"⬇ Downloading {MODEL_NAME} to persistent storage...")
    logger.info(f"   Cache directory: {CACHE_DIR}")
    
    try:
        snapshot_path = snapshot_download(
            repo_id=MODEL_NAME,
            cache_dir=str(CACHE_DIR),  # Use cache_dir, not local_dir
            resume_download=True,
            token=os.getenv("HF_TOKEN"),
        )
        
        logger.info(f"✓ Model successfully downloaded to {snapshot_path}")
        return snapshot_path
        
    except Exception as e:
        logger.error(f"✗ Failed to download model: {e}")
        raise


def get_model_size_mb() -> float:
    """Helper to check model size in persistent storage."""
    model_cache_name = MODEL_NAME.replace("/", "--")
    model_cache_path = CACHE_DIR / f"models--{model_cache_name}"
    
    if not model_cache_path.exists():
        return 0.0
    
    total_size = sum(f.stat().st_size for f in model_cache_path.rglob('*') if f.is_file())
    return total_size / (1024 * 1024)  # Convert to MB