# =============================================================================
# JAG-GPT Backend — Python 3.11 + FastAPI + LlamaIndex + CPU torch
# =============================================================================
# WORKDIR is /app throughout so that JAG-GPT.py's relative ".index_cache" path
# resolves to /app/.index_cache — mount your Railway volume there.
#
# Build context: ./Backend   (the Backend/ subdirectory)
#   docker build -f Dockerfile -t jaggpt-backend .
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

# Pre-built FAISS / BM25 index cache — baked into the image so cold starts are
# instant (~30 s to load) and Railway never spends compute rebuilding the index.
#
# HOW TO UPDATE THE CACHE:
#   1. Run python build_cache.py  (from the Backend/ directory)
#      This writes the index to Backend/API/.index_cache/.
#   2. Run .\build_and_push.ps1 -ImageTag ghcr.io/YOUR_USER/jaggpt-backend:latest
#      This builds this Dockerfile (with the cache baked in) and pushes it.
#   3. Railway pulls the new image automatically on the next deploy.
#
# IMPORTANT: API/.index_cache/ must exist locally before running docker build.
# It is gitignored (large binary data); build_cache.py generates it.
COPY API/.index_cache/ /app/.index_cache/

# Entrypoint script: validates regs_combined.json at startup and downloads
# it from REGS_JSON_URL if it is missing or is a Git LFS pointer file.
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create the Logs directory so JAG-GPT.py can write QA logs without error.
RUN mkdir -p /app/AI_Work/Logs

# ---------------------------------------------------------------------------
# 4. Pre-download HuggingFace models into the image.
#    This bakes ~1.5 GB of model weights into the layer so that cold starts
#    are fast and the container never needs to reach HuggingFace at runtime.
#    Models downloaded:
#      - mixedbread-ai/mxbai-embed-large-v1  (primary embedding model)
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

# ---------------------------------------------------------------------------
# 5. Runtime environment defaults.
#    Override OLLAMA_API_KEY in Railway service settings (never bake secrets).
#    JAG_INDEX_CACHE can override the ".index_cache" path if desired.
# ---------------------------------------------------------------------------
ENV JAG_EMBED_DEVICE=cpu
ENV JAG_JSON_PATH=/app/AI_Work/regs_combined.json
ENV PORT=8000

EXPOSE 8000

# Healthcheck so Railway (and docker-compose) wait for RAG init to finish.
# /health returns 503 until JAG-GPT finishes building the FAISS index.
HEALTHCHECK --interval=15s --timeout=5s --start-period=300s --retries=20 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# entrypoint.sh validates / downloads regs_combined.json, then execs uvicorn.
# Run from /app so .index_cache resolves to /app/.index_cache (Railway volume).
ENTRYPOINT ["/app/entrypoint.sh"]
