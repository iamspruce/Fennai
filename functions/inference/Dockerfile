# ============= Builder Stage =============
FROM nvcr.io/nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04 AS builder
ENV DEBIAN_FRONTEND=noninteractive

# Install Python, FFmpeg, and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-venv python3.10-dev libpython3.10-dev python3-pip git \
    ffmpeg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create clean venv
RUN python3.10 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Install deps + hf-transfer
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir "huggingface_hub[hf-transfer]>=0.24"

# Enable ultra-fast download mode
ENV HF_HUB_ENABLE_HF_TRANSFER=1

# Download model at build time
ARG HF_TOKEN
ENV HF_TOKEN=${HF_TOKEN}
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download( \
    repo_id='microsoft/VibeVoice-1.5B', \
    local_dir='/app/models/VibeVoice-1.5B', \
    local_dir_use_symlinks=False, \
    token='${HF_TOKEN}', \
    ignore_patterns=['*.msgpack', '*.h5', '*.safetensors'] \
)" && \
    echo "Model baked successfully (~60–90 sec thanks to hf-transfer!)"

# ============= Runtime Stage =============
FROM nvcr.io/nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

# Install runtime dependencies including FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/* && apt-get clean

RUN useradd -m appuser
WORKDIR /app
USER appuser

# Copy venv and models from builder
COPY --from=builder --chown=appuser:appuser /opt/venv /opt/venv
COPY --from=builder --chown=appuser:appuser /app/models /app/models

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1

# Copy application code with proper structure
COPY --chown=appuser:appuser main.py .
COPY --chown=appuser:appuser config.py .
COPY --chown=appuser:appuser middleware.py .

# Copy vibevoice package
COPY --chown=appuser:appuser vibevoice ./vibevoice

# Copy utils package with __init__.py
COPY --chown=appuser:appuser utils/__init__.py ./utils/__init__.py
COPY --chown=appuser:appuser utils/*.py ./utils/

# Copy routes package with __init__.py
COPY --chown=appuser:appuser routes/__init__.py ./routes/__init__.py
COPY --chown=appuser:appuser routes/*.py ./routes/

# Copy firebase package with __init__.py (for imports from proxy)
COPY --chown=appuser:appuser firebase/__init__.py ./firebase/__init__.py
COPY --chown=appuser:appuser firebase/*.py ./firebase/

EXPOSE 8080
CMD ["python", "main.py"]