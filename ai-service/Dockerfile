# ============================================================
# AI Service — Dockerfile
# ============================================================
# python:3.11-slim keeps the image small while providing all
# CPython features needed by sentence-transformers & gitpython.
# ============================================================

FROM python:3.11-slim

# git is required by gitpython to clone repositories at scan time
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/ai-service

# Copy and install Python dependencies first (layer-cache friendly)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the source code
COPY . .

# The Hugging Face model cache is mounted as a named volume by compose.
# Setting HF_HOME here as a sensible default; compose overrides it.
ENV HF_HOME=/root/.cache/huggingface

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
