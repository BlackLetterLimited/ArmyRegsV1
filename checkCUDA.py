"""
Diagnose why CUDA may not be available for GPU-accelerated embedding generation.
"""
import sys

def main():
    print("=" * 60)
    print("CUDA / GPU diagnostics for embedding generation")
    print("=" * 60)

    # 1. Python & PyTorch
    print(f"\n[Python] {sys.version}")
    try:
        import torch
        print(f"[PyTorch] version {torch.__version__}")
    except ImportError as e:
        print(f"[PyTorch] NOT INSTALLED: {e}")
        return

    # 2. CUDA availability
    cuda_available = torch.cuda.is_available()
    print(f"\n[torch.cuda.is_available()] {cuda_available}")

    # 3. PyTorch CUDA build (most common cause of "False" above)
    build_cuda = getattr(torch.version, "cuda", None)
    if build_cuda is None or build_cuda == "":
        print("[PyTorch CUDA build] This PyTorch build has NO CUDA support (CPU-only).")
        print("  -> Fix: install CUDA-enabled PyTorch, e.g.:")
        print("     pip install torch --index-url https://download.pytorch.org/whl/cu121")
        print("     (adjust cu121 to your CUDA version: cu118, cu124, etc.)")
    else:
        print(f"[PyTorch CUDA build] {build_cuda}")

    # 4. GPU count and names
    if cuda_available:
        print(f"[GPU count] {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            print(f"  Device {i}: {torch.cuda.get_device_name(i)}")
    else:
        print("[GPU count] N/A (CUDA not available)")

    # 5. CUDA driver (from PyTorch)
    try:
        # torch.cuda.get_device_capability() can fail if no CUDA; get_device_properties is safer
        if cuda_available and torch.cuda.device_count() > 0:
            props = torch.cuda.get_device_properties(0)
            print(f"\n[GPU 0] Compute capability: {props.major}.{props.minor}")
    except Exception as e:
        print(f"\n[GPU props] Error: {e}")

    # 6. Optional: nvidia-smi style info via subprocess (driver version)
    print("\n[NVIDIA driver (nvidia-smi)]")
    try:
        import subprocess
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if out.returncode == 0 and out.stdout.strip():
            for line in out.stdout.strip().split("\n"):
                print(f"  {line}")
        else:
            subprocess.run(["nvidia-smi"], capture_output=False, timeout=5)
    except FileNotFoundError:
        print("  nvidia-smi not found. Is the NVIDIA driver installed?")
    except Exception as e:
        print(f"  Error: {e}")

    print("\n" + "=" * 60)

if __name__ == "__main__":
    main()