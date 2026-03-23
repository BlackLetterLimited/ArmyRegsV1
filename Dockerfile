# =============================================================================
# JAG-GPT — Root Dockerfile for Railway deployment (backend service)
# =============================================================================
# Build context: repository root (JAGGPT/).
# This file is used when Railway is pointed at the repo root.  For an
# alternative setup where each service uses its own subdirectory, see
# Backend/railway.toml and web/railway.toml — those files explain how to
# configure separate Root Directory settings in the Railway dashboard.
#
# Frontend service:
#   Create a second Railway service in the same project, set its
#   Root Directory to "web/", and Railway's Nixpacks builder will detect
#   Next.js automatically (no Dockerfile needed for the frontend).
#
# Index cache (important — read before first deploy):
#   The FAISS/BM25 index (~2 GB) is excluded from git (.gitignore) so it
#   cannot be baked into the image here.  On first deploy Railway will build
#   the index from regs_combined.json (~5–30 min depending on resources).
#   To make that work correctly:
#     1. In the Railway dashboard add a Volume to this service
#        mounted at  /app/.index_cache
#     2. The app writes the finished index there; subsequent restarts and
#        redeploys reuse it instantly.
#
# Required environment variables (set in Railway dashboard):
#   OLLAMA_API_KEY   — Ollama API key for LLM access
#   JAG_EMBED_DEVICE — cpu  (default; change to "cuda" only if GPU plan)
#   CORS_ORIGINS     — comma-separated list of allowed frontend origins
#                      e.g. https://your-app.up.railway.app
# =============================================================================

FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------------------------------------------------------------------------
# 1. PyTorch CPU-only wheel (~200 MB).
#    Must be installed BEFORE other requirements so pip never pulls the
#    2.5 GB CUDA wheel from PyPI when resolving torch later.
# ---------------------------------------------------------------------------
RUN pip install --no-cache-dir \
        "torch==2.2.0+cpu" \
        --index-url https://download.pytorch.org/whl/cpu

# ---------------------------------------------------------------------------
# 2. Python dependencies (everything except torch).
# ---------------------------------------------------------------------------
COPY Backend/AI_Work/requirements-docker.txt /tmp/requirements-docker.txt
RUN pip install --no-cache-dir -r /tmp/requirements-docker.txt

# ---------------------------------------------------------------------------
# 3. Application source.
#    Archive/ and Support/ are excluded by .dockerignore.
# ---------------------------------------------------------------------------
COPY Backend/AI_Work/ ./AI_Work/
COPY Backend/API/     ./API/

# NOTE: The index cache (Backend/API/.index_cache/) is NOT copied here
# because it is excluded from git.  Railway will use the Volume mounted at
# /app/.index_cache to persist the index across deploys.

# Ensure the cache and log directories exist so the app can write to them.
RUN mkdir -p /app/.index_cache /app/AI_Work/Logs

# ---------------------------------------------------------------------------
# 4. Pre-download HuggingFace embedding + reranker models (~1.5 GB).
#    Baking them into the image avoids a network fetch on every cold start
#    and removes any runtime dependency on the HuggingFace CDN.
#      - mixedbread-ai/mxbai-embed-large-v1   (primary embeddings)
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
# 5. Runtime defaults — all can be overridden via Railway environment vars.
# ---------------------------------------------------------------------------
ENV JAG_EMBED_DEVICE=cpu
ENV JAG_JSON_PATH=/app/AI_Work/regs_combined.json
ENV PORT=8000

EXPOSE ${PORT}

# Liveness probe only — /ping returns 200 as soon as uvicorn is up.
# This prevents Railway from restarting the service during the (potentially
# very long) first-run index build.  Use /health to check full readiness.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD curl -f http://localhost:${PORT}/ping || exit 1

# --app-dir adds /app/API to sys.path so `main` resolves to JAG-GPT-API.py
# without requiring a hyphen in the module name.
CMD sh -c "uvicorn main:app --app-dir /app/API --host 0.0.0.0 --port ${PORT}"
