# functions/inference/download_model.py
import os
from pathlib import Path
from huggingface_hub import snapshot_download

MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/VibeVoice-1.5B")  # Env var for flexibility
MODELS_DIR = Path("/workspace/models")
MODELS_DIR.mkdir(parents=True, exist_ok=True)

def download_if_missing():
    target_dir = MODELS_DIR / MODEL_NAME.split("/")[-1]
    if target_dir.exists():
        print(f"Model already cached at {target_dir}")
        return
    
    print(f"Downloading {MODEL_NAME} to {target_dir}...")
    try:
        snapshot_download(
            repo_id=MODEL_NAME,
            local_dir=target_dir,
            local_dir_use_symlinks=False,
            resume_download=True,
            token=os.getenv("HF_TOKEN")  # Optional: Hugging Face token for gated models
        )
        print("Model download complete.")
    except Exception as e:
        print(f"Download failed: {e}")
        raise

if __name__ == "__main__":
    download_if_missing()