#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Split an Army Regulation PDF into chunks keyed by paragraph numbering
(e.g., "3–5", "3–5 a.", "3–5 b. (1)", "3–6 a. (2) (a)").

Usage:
  pip install pdfplumber
  python split_ar_pdf.py <file.pdf> [out_prefix]

Outputs:
  - <out_prefix>_by_id.json        # map: paragraph_id -> text
  - <out_prefix>_ordered.ndjson    # one JSON object per chunk in reading order
  - <out_prefix>_chunks/           # folder of .txt files per paragraph_id
"""

import re
import json
from pathlib import Path
import sys
import pdfplumber

# ---------------------------
# Regex configuration
# ---------------------------

# Accept hyphen or en dash in paragraph IDs: "3–5" or "3-5", optional trailing dot.
PARA_ID = r'(?P<para>\b\d{1,3}[-–]\d{1,3})(?:\.)?'

# Master detector for a new paragraph line that may also include inline subparts.
MASTER = re.compile(
    r'^' + PARA_ID +
    r'(?:' +
        r'(?:\s+[a-z]\.)?' +          # optional "a."
        r'(?:\s+$\d+$)?' +          # optional "(1)"
        r'(?:\s+$[a-z]$)?' +        # optional "(a)"
    r')\b'
)

# Lines that begin with Note/Notes should be treated as part of current paragraph.
NOTE_LINE = re.compile(r'^(Note[s]?[:\.])\s', flags=re.IGNORECASE)

# Sub-level detectors used when continuing under the current paragraph.
SUB_LETTER = re.compile(r'^([a-z]\.)\b')      # "a."
SUB_NUM = re.compile(r'^($\d+$)\b')         # "(1)"
SUB_PAREN_LETTER = re.compile(r'^($[a-z]$)\b')  # "(a)"


# ---------------------------
# Text extraction and cleanup
# ---------------------------

def extract_text_from_pdf(pdf_path: str) -> str:
    chunks = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            chunks.append(t)
    return "\n".join(chunks)

def normalize_text(text: str) -> str:
    # Join hyphenated line breaks: "differ-\nence" -> "difference"
    text = re.sub(r'-\n', '', text)
    # Normalize newlines
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    # Collapse spaces/tabs but keep newlines
    text = re.sub(r'[ \t]+', ' ', text)
    # Trim trailing spaces per line
    text = '\n'.join(line.strip() for line in text.split('\n'))
    return text


# ---------------------------
# Parsing into paragraph chunks
# ---------------------------

def parse_paragraphs(full_text: str):
    """
    Returns:
      - by_id: dict mapping id -> combined text
      - ordered: list of items preserving order:
          {'id': '3–5 a. (1)', 'level': 2, 'text': '...'}
    """
    lines = full_text.split('\n')
    results = []
    current = None

    # Track current hierarchy
    current_para = None   # e.g., "3–5"
    current_a = None      # e.g., "a."
    current_1 = None      # e.g., "(1)"
    current_a_paren = None  # e.g., "(a)"

    def push_current():
        nonlocal current
        if current and current['text'].strip():
            results.append(current)

    for raw in lines:
        line = raw.strip()
        if not line:
            if current:
                current['text'] += '\n'
            continue

        m = MASTER.match(line)
        if m:
            # New base paragraph (and maybe inline subparts)
            push_current()
            current_para = m.group('para')
            current_a = None
            current_1 = None
            current_a_paren = None

            tail = line[m.end():].strip()
            id_parts = [current_para]

            # Inline "a."
            am = re.match(r'^(?:[–-]\s*)?([a-z]\.)\b', tail)  # tolerate a leading dash
            if am:
                current_a = am.group(1)
                id_parts.append(current_a)
                tail = tail[am.end():].strip()

            # Inline "(1)"
            nm = re.match(r'^($\d+$)\b', tail)
            if nm:
                current_1 = nm.group(1)
                id_parts.append(current_1)
                tail = tail[nm.end():].strip()

            # Inline "(a)"
            apm = re.match(r'^($[a-z]$)\b', tail)
            if apm:
                current_a_paren = apm.group(1)
                id_parts.append(current_a_paren)
                tail = tail[apm.end():].strip()

            para_id = ' '.join(id_parts)
            current = {'id': para_id, 'level': len(id_parts)-1, 'text': tail}
            continue

        # Treat Note/Notes as continuation of current paragraph
        if NOTE_LINE.match(line) and current:
            sep = ' ' if current['text'] and not current['text'].endswith('\n') else ''
            current['text'] += sep + line
            continue

        # Sub-levels under the current paragraph
        if current_para:
            am = SUB_LETTER.match(line)  # "a."
            if am:
                push_current()
                current_a = am.group(1)
                current_1 = None
                current_a_paren = None
                para_id = ' '.join(filter(None, [current_para, current_a]))
                current = {'id': para_id, 'level': 1, 'text': line[am.end():].strip()}
                continue

            nm = SUB_NUM.match(line)  # "(1)"
            if nm:
                push_current()
                current_1 = nm.group(1)
                current_a_paren = None
                para_id = ' '.join(filter(None, [current_para, current_a, current_1]))
                level = 2 if current_a else 1
                current = {'id': para_id, 'level': level, 'text': line[nm.end():].strip()}
                continue

            apm = SUB_PAREN_LETTER.match(line)  # "(a)"
            if apm and (current_a or current_1):
                push_current()
                current_a_paren = apm.group(1)
                para_id = ' '.join(filter(None, [current_para, current_a, current_1, current_a_paren]))
                level = 3 if (current_a and current_1) else 2
                current = {'id': para_id, 'level': level, 'text': line[apm.end():].strip()}
                continue

        # Continuation line
        if current:
            sep = ' ' if current['text'] and not current['text'].endswith('\n') else ''
            current['text'] += sep + line
        else:
            # Orphan text before first para id; ignore or collect if desired.
            pass

    # Flush last item
    push_current()

    # Build mapping by id (combine multi-line segments)
    by_id = {}
    for item in results:
        key = item['id']
        by_id.setdefault(key, [])
        by_id[key].append(item['text'].strip())

    by_id = {k: '\n'.join(v).strip() for k, v in by_id.items()}
    return by_id, results


# ---------------------------
# Saving outputs
# ---------------------------

def save_outputs(by_id, ordered_items, out_prefix: str):
    with open(f"{out_prefix}_by_id.json", "w", encoding="utf-8") as f:
        json.dump(by_id, f, ensure_ascii=False, indent=2)

    with open(f"{out_prefix}_ordered.ndjson", "w", encoding="utf-8") as f:
        for it in ordered_items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")

    out_dir = Path(f"{out_prefix}_chunks")
    out_dir.mkdir(exist_ok=True)
    for k, v in by_id.items():
        safe = re.sub(r'[^0-9a-zA-Z\-\.$$ ]+', '_', k).replace(' ', '_')
        (out_dir / f"{safe}.txt").write_text(v, encoding="utf-8")


# ---------------------------
# Entrypoint
# ---------------------------

def split_ar_pdf(pdf_path: str, out_prefix: str = "ar"):
    raw = extract_text_from_pdf(pdf_path)
    norm = normalize_text(raw)
    by_id, ordered = parse_paragraphs(norm)
    save_outputs(by_id, ordered, out_prefix)
    return by_id

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python split_ar_pdf.py <file.pdf> [out_prefix]")
        sys.exit(1)
    pdf_path = sys.argv[1]
    out_prefix = sys.argv[2] if len(sys.argv) > 2 else Path(pdf_path).stem
    split_ar_pdf(pdf_path, out_prefix)
