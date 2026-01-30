#!/usr/bin/env python3
import json
from pathlib import Path

def main():
    # Directory containing your JSON files (use "." for current dir)
    input_dir = Path(".")
    output_path = Path("all_regs_merged.json")

    all_items = []

    for path in sorted(input_dir.glob("*.json")):
        if path.name == output_path.name:
            # skip the output file if re-running
            continue
        print(f"Loading {path} ...")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                all_items.extend(data)
            else:
                print(f"Warning: {path} is not a JSON list, skipping.")
        except Exception as e:
            print(f"Error reading {path}: {e}")

    if not all_items:
        print("No items loaded from any JSON file.")
        return

    output_path.write_text(
        json.dumps(all_items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(all_items)} items to {output_path}")

if __name__ == "__main__":
    main()