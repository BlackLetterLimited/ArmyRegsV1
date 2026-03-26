<#
.SYNOPSIS
    Builds the JAG-GPT Docker image (with the vector index serialized inside)
    and pushes it to a container registry for Railway to pull and deploy.

.DESCRIPTION
    1. Builds the Docker image from the Backend/ directory.
       The Dockerfile runs build_cache.py during the build, which serializes
       the FAISS/BM25 index to /app/.index_cache inside the image.
       This step is slow (5-30 min) but happens once per image build.

    2. Pushes the image to the specified registry.

    Railway deploys from this image.  On every cold start it deserializes the
    pre-built index in ~30 seconds — no persistent Volume required.

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

    After pushing, configure Railway to use this image (one-time setup):
        Dashboard -> Backend service -> Settings -> Source -> Docker Image
        Image name: ghcr.io/yourusername/jaggpt-backend:latest
        (For private GHCR images, add RAILWAY_PRIVATE_REGISTRY credentials.)

    IMPORTANT: Remove any Railway Volume that was previously mounted at
    /app/.index_cache — it is no longer needed and would shadow the baked cache.
#>

param(
    [Parameter(Mandatory = $true, HelpMessage = "Full image tag, e.g. ghcr.io/user/jaggpt-backend:latest")]
    [string]$ImageTag
)

$ErrorActionPreference = "Stop"
$BackendDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- 1. Build the Docker image ---
# The index is built and serialized to disk inside the Docker build itself
# (via the RUN build_cache.py step in the Dockerfile).  No pre-build needed.
Write-Host ""
Write-Host "Building Docker image: $ImageTag"
Write-Host "  Context : $BackendDir"
Write-Host "  File    : $BackendDir\Dockerfile"
Write-Host "  Note    : The index build runs inside Docker (~5-30 min on CPU)."
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

# --- 2. Push to registry ---
Write-Host "Pushing: $ImageTag"
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
Write-Host "  IMPORTANT: Remove any Railway Volume mounted at /app/.index_cache."
Write-Host "  The serialized index is now baked into the image — no Volume needed."
Write-Host "---------------------------------------------------------------------"
Write-Host ""
