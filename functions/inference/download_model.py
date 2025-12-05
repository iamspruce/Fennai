# download_model.py
import os
from pathlib import Path
from huggingface_hub import snapshot_download
import logging

logger = logging.getLogger(__name__)

MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/models"))

# This is the actual directory where we want the model files to live
TARGET_DIR = CACHE_DIR / "VibeVoice-1.5B"   # ← simple flat name, no --models-- nonsense

def download_if_missing() -> str:
    """
    Downloads the model directly into a flat directory /models/VibeVoice-1.5B
    instead of using HF's complicated cache + symlinks structure.
    This is the only way that works reliably with GCS FUSE on Cloud Run.
    """
    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    # If config.json already exists → assume complete
    if (TARGET_DIR / "config.json").exists():
        logger.info(f"Model already present at {TARGET_DIR}")
        return str(TARGET_DIR)

    logger.info(f"Downloading {MODEL_NAME} directly into {TARGET_DIR} (GCS-friendly layout)...")

    snapshot_download(
        repo_id=MODEL_NAME,
        local_dir=TARGET_DIR,           # ← THIS IS THE KEY
        local_dir_use_symlinks=False,   # ← AND THIS IS CRUCIAL
        resume_download=True,
        token=os.getenv("HF_TOKEN"),
        ignore_patterns=["*.msgpack", "*.h5"],  # optional: skip unused files
    )

    logger.info(f"Model successfully downloaded to {TARGET_DIR}")
    return str(TARGET_DIR)