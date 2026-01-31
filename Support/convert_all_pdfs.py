#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Run pdf_to_json.py on every PDF in Support/data/regs_pdf."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def iter_pdfs(pdf_dir: Path):
    for path in sorted(pdf_dir.rglob("*.pdf")):
        if path.is_file():
            yield path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--pdf-dir",
        default=Path(__file__).parent / "data" / "regs_pdf",
        type=Path,
        help="Directory containing PDFs (recursively scanned).",
    )
    ap.add_argument(
        "--python",
        default="python3",
        help="Python executable to run pdf_to_json.py",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands without executing.",
    )

    args = ap.parse_args()
    pdf_dir: Path = args.pdf_dir

    if not pdf_dir.exists():
        raise FileNotFoundError(pdf_dir)

    script_path = Path(__file__).parent / "pdf_to_json.py"
    if not script_path.exists():
        raise FileNotFoundError(script_path)

    pdfs = list(iter_pdfs(pdf_dir))
    if not pdfs:
        print(f"[WARN] No PDFs found under {pdf_dir}")
        return 0

    for pdf in pdfs:
        cmd = [args.python, str(script_path), "--pdf", str(pdf)]
        if args.dry_run:
            print(" ".join(cmd))
            continue
        subprocess.run(cmd, check=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
