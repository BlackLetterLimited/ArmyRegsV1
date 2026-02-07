#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Any, Iterable


def _coerce_subparagraph(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    return value or ""


def _combine_text(heading: str, text: str) -> str:
    if heading and heading not in text:
        return f"{heading}\n{text}"
    return text


def _load_json_file(path: Path) -> list[dict[str, str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[dict[str, str]] = []

    if isinstance(data, dict) and "chunks" in data:
        reg = (data.get("reg_number") or data.get("regulation") or "").strip()
        for ch in data.get("chunks", []):
            if not isinstance(ch, dict):
                continue
            para = (ch.get("paragraph") or ch.get("section") or "").strip()
            sub = _coerce_subparagraph(ch.get("subparagraph"))
            text = (ch.get("text") or "").strip()
            heading = (ch.get("heading_path") or "").strip()
            if not (reg and para and text):
                continue
            out.append(
                {
                    "regulation": reg,
                    "paragraph": para,
                    "subparagraph": sub,
                    "text": _combine_text(heading, text),
                }
            )
        return out

    if isinstance(data, list):
        for it in data:
            if not isinstance(it, dict):
                continue
            reg = (
                it.get("regulation")
                or it.get("reg_number")
                or it.get("reg")
                or ""
            ).strip()
            para = (it.get("paragraph") or it.get("section") or "").strip()
            sub = _coerce_subparagraph(it.get("subparagraph"))
            text = (it.get("text") or "").strip()
            if not (reg and para and text):
                continue
            out.append(
                {
                    "regulation": reg,
                    "paragraph": para,
                    "subparagraph": sub,
                    "text": text,
                }
            )
        return out

    return out


def _iter_json_files(root: Path) -> Iterable[Path]:
    for path in sorted(root.glob("*.json")):
        yield path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Combine Support/data/regs_json into a single flat JSON list."
    )
    parser.add_argument(
        "--input-dir",
        default="Support/data/regs_json",
        help="Directory containing per-regulation JSON files.",
    )
    parser.add_argument(
        "--output",
        default="regs_combined.json",
        help="Output JSON file path.",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_path = Path(args.output)

    if not input_dir.exists() or not input_dir.is_dir():
        raise SystemExit(f"Input directory not found: {input_dir}")

    combined: list[dict[str, str]] = []
    total_files = 0

    for path in _iter_json_files(input_dir):
        if path.resolve() == output_path.resolve():
            continue
        total_files += 1
        combined.extend(_load_json_file(path))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(combined, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"Combined {total_files} files into {output_path}")
    print(f"Total records: {len(combined)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
