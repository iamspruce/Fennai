# Use NVIDIA CUDA base with Python
FROM nvidia/cuda:12.2.2-devel-ubuntu22.04

# Install Python and system dependencies
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
    && rm -rf /var/lib/apt/lists/*

# Create symlink for python command
RUN ln -s /usr/bin/python3.10 /usr/bin/python

# Set up Python virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3.10 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Upgrade pip
RUN pip install --upgrade pip setuptools wheel

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install PyTorch with CUDA support FIRST
RUN pip install --no-cache-dir \
    torch>=2.1.0 \
    torchaudio>=2.1.0 \
    --index-url https://download.pytorch.org/whl/cu121

# Install remaining dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create model cache directory with proper permissions
RUN mkdir -p /workspace/models && chmod -R 777 /workspace/models

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV CUDA_VISIBLE_DEVICES=0
ENV MODEL_NAME=microsoft/VibeVoice-1.5B

# Optional: Attempt to download model during build
# This will not fail the build if it times out - model will download at runtime instead
RUN python download_model.py || echo "⚠️ Model download during build failed or timed out. Model will be downloaded at runtime on first request."

# Expose port
EXPOSE 8080

# Health check - longer start period for model download
HEALTHCHECK --interval=60s --timeout=10s --start-period=600s --retries=3 \
CMD curl -f http://localhost:8080/ || exit 1

# Run with functions-framework
CMD exec functions-framework --target=inference --port=8080 --host=0.0.0.0