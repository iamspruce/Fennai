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

# Set up Python virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3.10 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Upgrade pip
RUN pip install --upgrade pip

WORKDIR /app

# Copy requirements and install in correct order
COPY requirements.txt .

# Install PyTorch with CUDA support FIRST
RUN pip install --no-cache-dir torch>=2.1.0 torchaudio>=2.1.0 --index-url https://download.pytorch.org/whl/cu121

# Install remaining dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Pre-download model
RUN python download_model.py

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

# Run the application
CMD ["python", "main.py"]