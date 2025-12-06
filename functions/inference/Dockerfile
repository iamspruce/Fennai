# ============= Builder Stage =============
FROM nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-venv python3-pip git \
    && rm -rf /var/lib/apt/lists/*

# Create clean venv
RUN python3.10 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Install deps + hf-transfer (this is the magic for 60–90 sec downloads)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir "huggingface_hub[hf-transfer]>=0.24"

# Enable ultra-fast download mode
ENV HF_HUB_ENABLE_HF_TRANSFER=1

# ←←← THIS IS THE ONLY LINE THAT MATTERS FOR THE SIMPLE METHOD
ARG HF_TOKEN
ENV HF_TOKEN=${HF_TOKEN}
# ←←←

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
FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends python3.10 \
    && rm -rf /var/lib/apt/lists/* && apt-get clean

RUN useradd -m appuser
WORKDIR /app
USER appuser

COPY --from=builder --chown=appuser:appuser /opt/venv /opt/venv
COPY --from=builder --chown=appuser:appuser /app/models /app/models

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1

# Copy only what your app actually needs
COPY --chown=appuser:appuser main.py .
COPY --chown=appuser:appuser utils.py .
COPY --chown=appuser:appuser vibevoice ./vibevoice

EXPOSE 8080
CMD ["python", "main.py"]