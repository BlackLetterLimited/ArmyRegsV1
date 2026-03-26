# =============================================================================
# JAG-GPT Backend — Python 3.11 + FastAPI + LlamaIndex + CPU torch
# =============================================================================
# Build context: ./Backend   (the Backend/ subdirectory)
#   docker build -f Dockerfile -t jaggpt-backend .
#
# The FAISS/BM25 vector index is built DURING this docker build (step 3b) and
# baked into the image at /app/.index_cache.  Railway loads the serialized
# index from disk on every deploy (~30 s) — no persistent Volume needed.
#
# To update the index (e.g. after changing regs_combined.json):
#   1. Rebuild the image:  .\build_and_push.ps1 -ImageTag ghcr.io/...
#   2. Railway pulls the new image automatically on the next deploy.
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
# 3b. Pre-download HuggingFace models then serialize the vector index.
#
#     HF_HOME is set here (before the index build) so that:
#       a) The embedding/reranker models are downloaded to /app/.hf_cache.
#       b) The index build (build_cache.py) reuses those cached models
#          instead of re-downloading them to a different path.
#
#     build_cache.py detects that JAG_INDEX_CACHE_DIR + JAG_JSON_PATH are
#     already set, skips local-path discovery, decompresses the .gz, builds
#     the FAISS/BM25 index, and writes it to /app/.index_cache.
#
#     The index build is slow (5–30 min on CPU) but runs once per image
#     build.  Every Railway deploy deserializes it in ~30 s — no Volume
#     required.
#
#     After the index is written the decompressed JSON is removed; the .gz
#     stays so entrypoint.sh can re-decompress it at container startup.
# ---------------------------------------------------------------------------
ENV HF_HOME=/app/.hf_cache
RUN python -c "\
from sentence_transformers import SentenceTransformer, CrossEncoder; \
print('>>> Downloading embedding model (mxbai-embed-large-v1)...'); \
SentenceTransformer('mixedbread-ai/mxbai-embed-large-v1'); \
print('>>> Downloading reranker (ms-marco-MiniLM-L-6-v2)...'); \
CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2'); \
print('>>> Models cached to /app/.hf_cache.')"

COPY build_cache.py /app/build_cache.py
RUN JAG_INDEX_CACHE_DIR=/app/.index_cache \
    JAG_JSON_PATH=/app/AI_Work/regs_combined.json \
    JAG_EMBED_DEVICE=cpu \
    python /app/build_cache.py \
 && rm -f /app/AI_Work/regs_combined.json

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
