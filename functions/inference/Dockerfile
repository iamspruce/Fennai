# Use NVIDIA CUDA base with Python
FROM nvidia/cuda:12.2.2-devel-ubuntu22.04

# Install system dependencies
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3.10-venv \
    python3-pip \
    python3.10-dev \
    git \
    ffmpeg \
    libsndfile1 \
    build-essential \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create python symlink
RUN ln -s /usr/bin/python3.10 /usr/bin/python

# Create and activate virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3.10 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Upgrade pip
RUN pip install --upgrade pip setuptools wheel

WORKDIR /app

# Copy requirements first (caching)
COPY requirements.txt .

# Install PyTorch + CUDA FIRST (critical for correct wheel)
RUN pip install --no-cache-dir \
    torch==2.3.0+cu121 \
    torchaudio==2.3.0+cu121 \
    --index-url https://download.pytorch.org/whl/cu121

# Install everything else
RUN pip install --no-cache-dir -r requirements.txt

# Install Gunicorn + Flask
RUN pip install --no-cache-dir gunicorn Flask==3.0.0

# Copy app code
COPY . .

# Create model cache directory (for Persistent Disk)
RUN mkdir -p /models && chmod -R 777 /models

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV CUDA_VISIBLE_DEVICES=0
ENV MODEL_NAME=microsoft/VibeVoice-1.5B
ENV CACHE_DIR=/models

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8080}/health || exit 1

# Use Gunicorn (PRODUCTION READY)
CMD exec gunicorn \
    --bind 0.0.0.0:$PORT \
    --workers 1 \
    --threads 1 \
    --worker-class sync \
    --timeout 900 \
    --max-requests 10 \
    --max-requests-jitter 5 \
    --log-level info \
    --access-logfile - \
    --error-logfile - \
    "main:app"