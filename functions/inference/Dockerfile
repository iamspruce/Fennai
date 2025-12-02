# Multi-stage: Build (download model) → Runtime (GPU-optimized)
FROM python:3.10-slim AS builder

# Install build deps
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps (no GPU yet)
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy code
COPY . .

# Pre-download model (runs download_model.py)
RUN python download_model.py

# Runtime stage: NVIDIA CUDA base for GPU + Flash Attention
FROM nvidia/cuda:12.2.2-devel-ubuntu22.04

# Install Python + runtime deps
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3.10-venv \
    python3-pip \
    git \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Create venv
ENV VIRTUAL_ENV=/opt/venv
RUN python3.10 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install runtime deps (GPU-enabled)
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.10/site-packages /opt/venv/lib/python3.10/site-packages
COPY --from=builder /app .

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

# Run the function
CMD ["python", "main.py"]