#!/usr/bin/env python3

import json
from pathlib import Path

def combine_regulations_json(input_folder, output_file):
    input_folder = Path(input_folder)
    all_regs = []

    for path in sorted(input_folder.glob("*.json")):
        with path.open("r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                print(f"Skipping {path} (invalid JSON): {e}")
                continue

        regs = data.get("regulations")
        if isinstance(regs, list):
            all_regs.extend(regs)
        else:
            print(f"Skipping {path} (no 'regulations' list)")

    combined = {"regulations": all_regs}

    output_path = Path(output_file)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(all_regs)} regulations to {output_path}")

if __name__ == "__main__":
    # change these as needed
    input_folder = "./data/router_json"
    output_file = "./data/router.json"
    combine_regulations_json(input_folder, output_file)
