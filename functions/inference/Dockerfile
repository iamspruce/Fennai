# functions/inference/Dockerfile
FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

# Install Python and dependencies
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first (for caching)
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Install HuggingFace CLI for downloading models
RUN pip3 install --no-cache-dir huggingface-hub

# Download and bake model into image
ARG HF_TOKEN
ENV HF_TOKEN=${HF_TOKEN}

RUN python3 -c "\
from huggingface_hub import snapshot_download; \
import os; \
snapshot_download( \
    repo_id='microsoft/VibeVoice-1.5B', \
    local_dir='/app/models/VibeVoice-1.5B', \
    local_dir_use_symlinks=False, \
    token=os.getenv('HF_TOKEN'), \
    ignore_patterns=['*.msgpack', '*.h5'] \
)"

# Verify model was downloaded
RUN ls -lah /app/models/VibeVoice-1.5B && \
    test -f /app/models/VibeVoice-1.5B/config.json || \
    (echo "Model download failed" && exit 1)

# Copy application code
COPY . .

# Expose port
EXPOSE 8080

# Environment variables (set at runtime via Cloud Run)
ENV MODEL_NAME=microsoft/VibeVoice-1.5B
ENV PYTHONUNBUFFERED=1

# Run the application
CMD ["python3", "main.py"]