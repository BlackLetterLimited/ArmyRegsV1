"""
Build the JAG-GPT FAISS/BM25 index cache locally so it can be baked into
the Docker image.  Railway will then load the pre-built cache at startup in
~30 seconds instead of spending 5-30 minutes re-indexing on every deploy.

Usage (from anywhere inside the repo):
    cd Backend
    python build_cache.py

    # Or from the repo root:
    python Backend/build_cache.py

Output:
    Backend/API/.index_cache/<stem>_<sig>/   ← FAISS index files
    Backend/API/.index_cache/<stem>_<sig>/.cache_ok  ← sentinel (written last)

After this script succeeds, build and push the Docker image:
    .\\build_and_push.ps1 -ImageTag ghcr.io/YOUR_GITHUB_USERNAME/jaggpt-backend:latest
"""
import gzip
import importlib.util
import os
import shutil
import sys
from pathlib import Path


def _detect_device() -> str:
    """Return 'cuda' if a CUDA-capable GPU is available, otherwise 'cpu'."""
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            print(f"  GPU detected : {name} — using CUDA for embeddings.")
            return "cuda"
    except ImportError:
        pass
    print("  No CUDA GPU detected — falling back to CPU for embeddings.")
    return "cpu"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_backend_dir() -> Path:
    """Locate the Backend/ directory by looking for its Dockerfile."""
    candidate = Path(__file__).resolve().parent
    for _ in range(4):
        if (candidate / "Dockerfile").exists() and (candidate / "AI_Work").is_dir():
            return candidate
        candidate = candidate.parent
    raise RuntimeError(
        "Cannot locate Backend/ directory.  "
        "Run this script from inside Backend/ or the repo root."
    )


def _ensure_json(backend_dir: Path) -> Path:
    """
    Return a path to a valid regs_combined.json, decompressing from .gz if needed.
    The .gz file is what is committed to git; the plain JSON is gitignored.
    """
    json_path = backend_dir / "AI_Work" / "regs_combined.json"
    gz_path   = json_path.with_suffix(".json.gz")

    if json_path.exists() and json_path.stat().st_size > 1_000_000:
        print(f"  regs_combined.json already present ({json_path.stat().st_size:,} bytes).")
        return json_path

    if gz_path.exists():
        print(f"  Decompressing {gz_path.name} …")
        with gzip.open(gz_path, "rb") as src, open(json_path, "wb") as dst:
            shutil.copyfileobj(src, dst)
        print(f"  Decompressed  → {json_path.stat().st_size:,} bytes")
        return json_path

    raise FileNotFoundError(
        f"Neither {json_path} nor {gz_path} was found.\n"
        "Ensure regs_combined.json.gz is present in Backend/AI_Work/."
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    backend_dir  = _find_backend_dir()
    ai_work_dir  = backend_dir / "AI_Work"
    cache_dir    = backend_dir / "API" / ".index_cache"
    json_path    = _ensure_json(backend_dir)

    # Tell JAG-GPT.py where to write (and later read) the cache.
    os.environ["JAG_INDEX_CACHE_DIR"] = str(cache_dir)
    os.environ["JAG_JSON_PATH"]       = str(json_path)
    # Auto-detect GPU; override by setting JAG_EMBED_DEVICE before running.
    if "JAG_EMBED_DEVICE" not in os.environ:
        os.environ["JAG_EMBED_DEVICE"] = _detect_device()

    print()
    print("JAG-GPT local cache builder")
    print(f"  Backend dir  : {backend_dir}")
    print(f"  JSON path    : {json_path}")
    print(f"  Cache output : {cache_dir}")
    print(f"  Embed device : {os.environ['JAG_EMBED_DEVICE']}")
    print()

    # Load JAG-GPT.py as a module without executing the __main__ block.
    sys.path.insert(0, str(ai_work_dir))
    jag_path = ai_work_dir / "JAG-GPT.py"
    spec     = importlib.util.spec_from_file_location("jag_gpt", str(jag_path))
    module   = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Build the index.  This is the slow step (5–30 min on CPU).
    module.initialize(str(json_path))

    # Confirm the sentinel file was written — this is what the server checks.
    sentinels = list(cache_dir.rglob(".cache_ok"))
    if not sentinels:
        print("\nERROR: .cache_ok sentinel not found — the cache may be incomplete.")
        sys.exit(1)

    print()
    print("Cache built successfully.")
    for s in sentinels:
        print(f"  Sentinel : {s}")

    total_bytes = sum(
        f.stat().st_size for f in cache_dir.rglob("*") if f.is_file()
    )
    print(f"  Total size : {total_bytes / 1_048_576:.1f} MB")
    print()
    print("Next step — build and push the Docker image:")
    print(r"  .\build_and_push.ps1 -ImageTag ghcr.io/YOUR_GITHUB_USERNAME/jaggpt-backend:latest")
    print()


if __name__ == "__main__":
    main()
