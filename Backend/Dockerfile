# =============================================================================
# JAG-GPT Backend — Python 3.11 + FastAPI + LlamaIndex + CPU torch
# =============================================================================
# Build context: ./Backend   (the Backend/ subdirectory)
#   docker build -f Dockerfile -t jaggpt-backend .
#
# The FAISS/BM25 vector index is built locally by build_and_push.ps1
# (GPU-accelerated when available) and then COPYd into the image at
# /app/.index_cache.  Railway deserializes it in ~30 s on every deploy
# with no persistent Volume required.
#
# To update the index (e.g. after changing regs_combined.json):
#   .\build_and_push.ps1 -ImageTag ghcr.io/YOUR_USER/jaggpt-backend:latest
# =============================================================================

FROM python:3.11-slim

# System build dependencies (removed after pip install to keep the layer lean)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------------------------------------------------------------------------
# 1. PyTorch CPU-only wheel (~200 MB) must be installed BEFORE the rest of
#    requirements so pip doesn't later pull the 2.5 GB CUDA wheel from PyPI.
# ---------------------------------------------------------------------------
RUN pip install --no-cache-dir \
        "torch==2.2.0+cpu" \
        --index-url https://download.pytorch.org/whl/cpu

# ---------------------------------------------------------------------------
# 2. Install production Python dependencies.
#    requirements-docker.txt pins the same versions as the dev freeze but
#    omits Jupyter/IPython packages that are not needed at runtime.
# ---------------------------------------------------------------------------
COPY AI_Work/requirements-docker.txt /tmp/requirements-docker.txt
RUN pip install --no-cache-dir -r /tmp/requirements-docker.txt

# ---------------------------------------------------------------------------
# 3. Copy application source.
#    Archive/ and Support/ are excluded by .dockerignore (dev/data-prep only).
# ---------------------------------------------------------------------------
COPY AI_Work/ ./AI_Work/
COPY API/     ./API/

# Compressed regulations data (~15 MB in git vs 240 MB uncompressed).
# entrypoint.sh decompresses this to regs_combined.json at container start.
COPY AI_Work/regs_combined.json.gz ./AI_Work/regs_combined.json.gz

# ---------------------------------------------------------------------------
# 3b. Pre-built FAISS / BM25 index cache — baked in via build_and_push.ps1.
#
#     build_and_push.ps1 runs build_cache.py locally BEFORE calling
#     docker build.  build_cache.py auto-detects CUDA and uses the GPU
#     when available, so the slow embedding step finishes in minutes
#     rather than half an hour.  The serialized files are then COPYd
#     into this image layer so Railway can deserialize them in ~30 s
#     on every deploy with no persistent Volume required.
#
#     To regenerate the cache (e.g. after updating regs_combined.json):
#       .\build_and_push.ps1 -ImageTag ghcr.io/YOUR_USER/jaggpt-backend:latest
#     The script rebuilds the index and then rebuilds + pushes the image.
# ---------------------------------------------------------------------------
COPY API/.index_cache/ /app/.index_cache/

# ---------------------------------------------------------------------------
# 4. Pre-download HuggingFace models into the image.
#    Bakes ~1.5 GB of model weights so cold starts never hit the HF CDN.
#      - mixedbread-ai/mxbai-embed-large-v1  (embedding model)
#      - cross-encoder/ms-marco-MiniLM-L-6-v2 (reranker)
# ---------------------------------------------------------------------------
ENV HF_HOME=/app/.hf_cache
RUN python -c "\
from sentence_transformers import SentenceTransformer, CrossEncoder; \
print('>>> Downloading embedding model (mxbai-embed-large-v1)...'); \
SentenceTransformer('mixedbread-ai/mxbai-embed-large-v1'); \
print('>>> Downloading reranker (ms-marco-MiniLM-L-6-v2)...'); \
CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2'); \
print('>>> Models cached successfully.')"

# Entrypoint script: validates regs_combined.json at startup and downloads
# it from REGS_JSON_URL if it is missing or is a Git LFS pointer file.
COPY entrypoint.sh /app/entrypoint.sh
# Strip Windows CRLF line endings (\r\n → \n) so the shebang is valid on Linux.
# This is a no-op when the file already has Unix line endings.
RUN sed -i 's/\r//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Create the Logs directory so JAG-GPT.py can write QA logs without error.
RUN mkdir -p /app/AI_Work/Logs

# ---------------------------------------------------------------------------
# 5. Runtime environment defaults.
#    Override OLLAMA_API_KEY in Railway service settings (never bake secrets).
#
#    JAG_INDEX_CACHE_DIR is pinned to the baked path so the app always
#    deserializes from the image layer, even if Railway injects
#    RAILWAY_VOLUME_MOUNT_PATH (which would otherwise shadow the baked files).
#    Remove any Railway Volume attachment for this service — it is not needed.
# ---------------------------------------------------------------------------
ENV JAG_EMBED_DEVICE=cpu
ENV JAG_INDEX_CACHE_DIR=/app/.index_cache
ENV JAG_JSON_PATH=/app/AI_Work/regs_combined.json
ENV PORT=8000

EXPOSE 8000

# Healthcheck — /health returns 503 until the RAG pipeline finishes loading.
# With the baked-in cache, startup is ~30-90 s (deserialize + model load).
# start-period is kept generous to handle slow Railway cold starts.
HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=12 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
