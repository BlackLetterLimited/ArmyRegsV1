<#
.SYNOPSIS
    Builds the JAG-GPT Docker image with the pre-built index cache baked in
    and pushes it to a container registry for Railway to pull and deploy.

.DESCRIPTION
    1. Verifies that build_cache.py has already been run (checks for .cache_ok).
    2. Builds the Docker image from the Backend/ directory.
    3. Pushes the image to the specified registry.

    Railway is then configured to deploy from this image (not build from source),
    so it never re-indexes on deploy — cold starts load the cache in ~30 seconds.

.PARAMETER ImageTag
    Full image reference including registry, username, repository name, and tag.
    Examples:
        ghcr.io/yourgithubusername/jaggpt-backend:latest
        docker.io/yourdockerhubusername/jaggpt-backend:latest

.EXAMPLE
    .\build_and_push.ps1 -ImageTag ghcr.io/yourusername/jaggpt-backend:latest

.NOTES
    Authenticate with your registry BEFORE running this script:

    GitHub Container Registry (GHCR):
        $env:GH_PAT = "ghp_..."   # needs write:packages scope
        echo $env:GH_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

    Docker Hub:
        docker login

    After pushing, configure Railway to use this image:
        Dashboard → Backend service → Settings → Source → Docker Image
        Image name: ghcr.io/yourusername/jaggpt-backend:latest
        (For private GHCR images, add RAILWAY_PRIVATE_REGISTRY credentials — see README.)
#>

param(
    [Parameter(Mandatory = $true, HelpMessage = "Full image tag, e.g. ghcr.io/user/jaggpt-backend:latest")]
    [string]$ImageTag
)

$ErrorActionPreference = "Stop"
$BackendDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── 1. Verify the index cache is present and complete ──────────────────────────
$CacheRoot = Join-Path $BackendDir "API\.index_cache"
if (-not (Test-Path $CacheRoot)) {
    Write-Error @"

Index cache not found at: $CacheRoot

Run the cache builder first:
    cd "$BackendDir"
    python build_cache.py
"@
    exit 1
}

$Sentinels = @(Get-ChildItem -Path $CacheRoot -Recurse -Filter ".cache_ok" -ErrorAction SilentlyContinue)
if ($Sentinels.Count -eq 0) {
    Write-Error @"

No .cache_ok sentinel found in: $CacheRoot

The cache is incomplete.  Re-run the cache builder:
    cd "$BackendDir"
    python build_cache.py
"@
    exit 1
}

Write-Host ""
Write-Host "Index cache verified ($($Sentinels.Count) sentinel(s)):"
$Sentinels | ForEach-Object { Write-Host "  $($_.FullName)" }
Write-Host ""

# ── 2. Build the Docker image ──────────────────────────────────────────────────
Write-Host "Building Docker image: $ImageTag"
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

# ── 3. Push to registry ────────────────────────────────────────────────────────
Write-Host "Pushing: $ImageTag"
docker push $ImageTag

if ($LASTEXITCODE -ne 0) {
    Write-Error "docker push failed (exit code $LASTEXITCODE)."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Push complete."
Write-Host ""
Write-Host "─────────────────────────────────────────────────────────────────────"
Write-Host "  Configure Railway to deploy from this image (one-time setup):"
Write-Host ""
Write-Host "    Dashboard → Backend service → Settings → Source"
Write-Host "    Change source type to : Docker Image"
Write-Host "    Image name            : $ImageTag"
Write-Host ""
Write-Host "  For private GHCR images, add these Railway environment variables:"
Write-Host "    RAILWAY_PRIVATE_REGISTRY_SERVER   = ghcr.io"
Write-Host "    RAILWAY_PRIVATE_REGISTRY_USERNAME = your-github-username"
Write-Host "    RAILWAY_PRIVATE_REGISTRY_PASSWORD = your-github-PAT (read:packages)"
Write-Host ""
Write-Host "  Also set JAG_INDEX_CACHE_DIR=/app/.index_cache in Railway env vars"
Write-Host "  so the app always reads from the baked-in cache, ignoring any volume."
Write-Host "─────────────────────────────────────────────────────────────────────"
Write-Host ""
