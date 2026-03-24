#!/bin/sh
# =============================================================================
# JAG-GPT backend entrypoint
# =============================================================================
# Ensures regs_combined.json is present and valid before uvicorn starts.
#
# Priority order:
#   1. regs_combined.json already exists and looks valid  → use it, do nothing
#   2. regs_combined.json.gz exists                       → decompress it
#   3. REGS_JSON_URL env var is set                       → download from URL
#   4. None of the above                                  → exit with clear error
#
# The .gz approach (case 2) is the standard Railway path: the compressed file
# (~15 MB) is committed to git as a normal file and COPY'd into the image by
# the Dockerfile.  Decompression takes ~2 seconds at container start.
# =============================================================================
set -e

REGS_PATH="${JAG_JSON_PATH:-/app/AI_Work/regs_combined.json}"
REGS_GZ="${REGS_PATH}.gz"

# ---------------------------------------------------------------------------
# Helper: is the file at $1 a real JSON file (not an LFS pointer, not empty)?
# ---------------------------------------------------------------------------
is_valid_json_file() {
    target="$1"
    [ -f "$target" ] || return 1
    file_size=$(wc -c < "$target" 2>/dev/null || echo 0)
    [ "$file_size" -lt 1000000 ] && return 1          # < 1 MB is suspicious
    first_line=$(head -n 1 "$target" 2>/dev/null || true)
    echo "$first_line" | grep -q "git-lfs" && return 1 # LFS pointer
    return 0
}

# ---------------------------------------------------------------------------
# Case 1: already have a valid JSON file
# ---------------------------------------------------------------------------
if is_valid_json_file "$REGS_PATH"; then
    size=$(wc -c < "$REGS_PATH")
    echo "[entrypoint] regs_combined.json ready (${size} bytes)."

# ---------------------------------------------------------------------------
# Case 2: decompress from .gz baked into the Docker image
# ---------------------------------------------------------------------------
elif [ -f "$REGS_GZ" ]; then
    echo "[entrypoint] Decompressing regs_combined.json.gz..."
    mkdir -p "$(dirname "$REGS_PATH")"
    gzip -dk "$REGS_GZ"          # -d decompress, -k keep the .gz file
    size=$(wc -c < "$REGS_PATH")
    echo "[entrypoint] Decompressed (${size} bytes)."

# ---------------------------------------------------------------------------
# Case 3: fallback — download from URL (e.g. if .gz was not COPY'd)
# ---------------------------------------------------------------------------
elif [ -n "$REGS_JSON_URL" ]; then
    echo "[entrypoint] Downloading regs_combined.json from REGS_JSON_URL..."
    mkdir -p "$(dirname "$REGS_PATH")"
    curl -fL "$REGS_JSON_URL" -o "$REGS_PATH"
    size=$(wc -c < "$REGS_PATH")
    echo "[entrypoint] Download complete (${size} bytes)."

# ---------------------------------------------------------------------------
# Case 4: nothing available — fail with a helpful message
# ---------------------------------------------------------------------------
else
    echo ""
    echo "ERROR: regs_combined.json is not available."
    echo "  Expected locations checked:"
    echo "    $REGS_PATH      (plain JSON)"
    echo "    $REGS_GZ  (compressed)"
    echo ""
    echo "  Fix options:"
    echo "    A) Ensure regs_combined.json.gz is COPY'd into the image (normal path)."
    echo "    B) Set REGS_JSON_URL to a direct download URL and redeploy."
    echo ""
    exit 1
fi

exec uvicorn main:app --app-dir /app/API --host 0.0.0.0 --port "${PORT:-8000}"
