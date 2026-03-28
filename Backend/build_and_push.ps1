<#
.SYNOPSIS
    Builds the JAG-GPT vector index locally (GPU-accelerated when available),
    bakes it into a Docker image, and pushes to a container registry for Railway.

.DESCRIPTION
    1. Runs build_cache.py on your local machine.
       build_cache.py auto-detects CUDA and uses your GPU when available,
       cutting the 5-30 min CPU embedding step down significantly.
       The serialized FAISS/BM25 index is written to Backend/API/.index_cache/.

    2. Builds the Docker image from the Backend/ directory.
       The Dockerfile COPYs the pre-built index in; docker build itself is fast.

    3. Pushes the image to the specified registry.

    Railway deploys from this image.  On every cold start it deserializes the
    baked-in index in ~30 seconds with no persistent Volume required.

.PARAMETER ImageTag
    Full image reference including registry, username, repository name, and tag.
    Examples:
        ghcr.io/yourgithubusername/jaggpt-backend:latest
        docker.io/yourdockerhubusername/jaggpt-backend:latest

.PARAMETER SkipCacheBuild
    Skip step 1 (re-use the existing API/.index_cache from a previous run).
    Useful when only source code changed and the regulations JSON is unchanged.

.EXAMPLE
    .\build_and_push.ps1 -ImageTag ghcr.io/yourusername/jaggpt-backend:latest

.EXAMPLE
    .\build_and_push.ps1 -ImageTag ghcr.io/yourusername/jaggpt-backend:latest -SkipCacheBuild

.NOTES
    Authenticate with your registry BEFORE running this script:

    GitHub Container Registry (GHCR):
        $env:GH_PAT = "ghp_..."   # needs write:packages scope
        echo $env:GH_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

    Docker Hub:
        docker login

    After pushing, configure Railway to use this image (one-time setup):
        Dashboard -> Backend service -> Settings -> Source -> Docker Image
        Image name: ghcr.io/yourusername/jaggpt-backend:latest
        (For private GHCR images, add RAILWAY_PRIVATE_REGISTRY credentials.)

    IMPORTANT: Remove any Railway Volume previously mounted at /app/.index_cache.
    The serialized index is baked into the image - no Volume needed.
#>

param(
    [Parameter(Mandatory = $true, HelpMessage = "Full image tag, e.g. ghcr.io/user/jaggpt-backend:latest")]
    [string]$ImageTag,

    [Parameter(Mandatory = $false, HelpMessage = "Skip build_cache.py and reuse the existing API/.index_cache")]
    [switch]$SkipCacheBuild
)

$ErrorActionPreference = "Stop"
$BackendDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------------------------------------------------------------------------
# 0. Authenticate with GHCR using a write:packages PAT (if pushing to ghcr.io)
# ---------------------------------------------------------------------------
if ($ImageTag -like "ghcr.io/*") {
    Write-Host ""
    Write-Host "Step 0: Authenticating with GitHub Container Registry (ghcr.io)..."

    if (-not $env:GH_USERNAME) {
        $env:GH_USERNAME = Read-Host "  Enter your GitHub username"
    } else {
        Write-Host "  Using GH_USERNAME: $env:GH_USERNAME"
    }

    if (-not $env:GH_PAT) {
        $PatSecure = Read-Host "  Enter your GitHub PAT (write:packages scope)" -AsSecureString
        $env:GH_PAT = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($PatSecure)
        )
    } else {
        Write-Host "  Using GH_PAT from environment."
    }

    $env:GH_PAT | docker login ghcr.io -u $env:GH_USERNAME --password-stdin
    if ($LASTEXITCODE -ne 0) {
        Write-Error "docker login to ghcr.io failed (exit code $LASTEXITCODE)."
        exit $LASTEXITCODE
    }
    Write-Host "  Login successful."
    Write-Host ""
}

# ---------------------------------------------------------------------------
# 1. Build and serialize the vector index locally (uses GPU when available)
# ---------------------------------------------------------------------------
if ($SkipCacheBuild) {
    Write-Host ""
    Write-Host "Skipping index build (-SkipCacheBuild). Verifying existing cache..."

    $CacheRoot = Join-Path $BackendDir "API\.index_cache"
    $Sentinels = @(Get-ChildItem -Path $CacheRoot -Recurse -Filter ".cache_ok" -ErrorAction SilentlyContinue)
    if ($Sentinels.Count -eq 0) {
        Write-Error @"

No valid cache found at: $CacheRoot

Run without -SkipCacheBuild to build the index first, or run:
    cd "$BackendDir"
    python build_cache.py
"@
        exit 1
    }
    Write-Host "  Cache OK ($($Sentinels.Count) sentinel(s) found)."
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "Step 1: Building vector index locally (GPU auto-detected)..."
    Write-Host "  Script : $BackendDir\build_cache.py"
    Write-Host "  Output : $BackendDir\API\.index_cache\"
    Write-Host "  Note   : build_cache.py uses CUDA if available, otherwise CPU."
    Write-Host ""

    # Run build_cache.py from the Backend directory so _find_backend_dir()
    # locates the correct Backend/ root via its Dockerfile + AI_Work heuristic.
    Push-Location $BackendDir
    try {
        python build_cache.py
        if ($LASTEXITCODE -ne 0) {
            Write-Error "build_cache.py failed (exit code $LASTEXITCODE)."
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }

    # Verify the sentinel that build_cache.py writes on success.
    $CacheRoot = Join-Path $BackendDir "API\.index_cache"
    $Sentinels = @(Get-ChildItem -Path $CacheRoot -Recurse -Filter ".cache_ok" -ErrorAction SilentlyContinue)
    if ($Sentinels.Count -eq 0) {
        Write-Error "build_cache.py exited 0 but no .cache_ok sentinel found in $CacheRoot. Aborting."
        exit 1
    }
    Write-Host ""
    Write-Host "Index serialized successfully ($($Sentinels.Count) sentinel(s))."
    Write-Host ""
}

# ---------------------------------------------------------------------------
# 2. Build the Docker image (fast - just COPYs the pre-built index)
# ---------------------------------------------------------------------------
Write-Host "Step 2: Building Docker image: $ImageTag"

Write-Host "  Context : $BackendDir"
Write-Host "  File    : $BackendDir\Dockerfile"
Write-Host ""

docker build `
    --file  "$BackendDir\Dockerfile" `
    --tag   $ImageTag `
    $BackendDir

if ($LASTEXITCODE -ne 0) {
    Write-Error "docker build failed (exit code $LASTEXITCODE)."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Build complete: $ImageTag"
Write-Host ""

# ---------------------------------------------------------------------------
# 3. Push to registry
# ---------------------------------------------------------------------------
Write-Host "Step 3: Pushing $ImageTag..."
docker push $ImageTag

if ($LASTEXITCODE -ne 0) {
    Write-Error "docker push failed (exit code $LASTEXITCODE)."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Push complete."
Write-Host ""
Write-Host "---------------------------------------------------------------------"
Write-Host "  Configure Railway to deploy from this image (one-time setup):"
Write-Host ""
Write-Host "    Dashboard -> Backend service -> Settings -> Source"
Write-Host "    Change source type to : Docker Image"
Write-Host "    Image name            : $ImageTag"
Write-Host ""
Write-Host "  For private GHCR images, add these Railway environment variables:"
Write-Host "    RAILWAY_PRIVATE_REGISTRY_SERVER   = ghcr.io"
Write-Host "    RAILWAY_PRIVATE_REGISTRY_USERNAME = your-github-username"
Write-Host "    RAILWAY_PRIVATE_REGISTRY_PASSWORD = your-github-PAT (read:packages)"
Write-Host ""
Write-Host "  Remove any Railway Volume mounted at /app/.index_cache."
Write-Host "  The serialized index is baked into the image - no Volume needed."
Write-Host "---------------------------------------------------------------------"
Write-Host ""
