# functions/inference/download_model.py
import os
from pathlib import Path
from huggingface_hub import snapshot_download
import logging

logger = logging.getLogger(__name__)

MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/models"))  # ← Persistent Disk
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def download_if_missing() -> str:
    """Download model once and return the snapshot path."""
    model_path = CACHE_DIR / f"models--{MODEL_NAME.replace('/', '--')}"
    
    if model_path.exists() and any(model_path.iterdir()):
        snapshot_dir = next((model_path / "snapshots").iterdir(), None)
        if snapshot_dir and (snapshot_dir / "config.json").exists():
            logger.info(f"Model already cached at {snapshot_dir}")
            return str(snapshot_dir)

    logger.info(f"Downloading {MODEL_NAME} to persistent disk...")
    snapshot_path = snapshot_download(
        repo_id=MODEL_NAME,
        local_dir=str(model_path),
        local_dir_use_symlinks=False,
        resume_download=True,
        token=os.getenv("HF_TOKEN"),
    )
    logger.info(f"Model downloaded to {snapshot_path}")
    return snapshot_path