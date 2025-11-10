#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
import json
import sys
from pathlib import Path
import pdfplumber

# ---------------------------
# Configuration
# ---------------------------

REGULATION_TITLE = "AR 670–1"  # set or override as needed

# Paragraph ID: "3-7", "3–7", or "3—7", optional trailing dot.
PARA_ID_RE = r'(?P<para>\d{1,3}[-–—]\d{1,3})(?:\.)?'

# Heading detector: start of line, paragraph ID, then space/end/heading punctuation.
# Relaxed to allow a single space (many regs are "3–7. Title").
PARA_HEADING = re.compile(rf'^{PARA_ID_RE}(?=\s|$|[:;—–-])')

NOTE_LINE = re.compile(r'^(Note[s]?[:\.])\s', flags=re.IGNORECASE)

# Subpart tokens at line start
SUB_LETTER = re.compile(r'^([a-z])\.\s+')          # "a. "
SUB_NUM = re.compile(r'^$(\d+)$\s+')             # "(1) "
SUB_PAREN_LETTER = re.compile(r'^$([a-z])$\s+')  # "(a) "
SUB_PAREN_CAP = re.compile(r'^$([A-Z])$\s+')     # "(A) "

# Inline tokenizers (used only for splitting heading tail)
TOK_LETTER = re.compile(r'(?:(?<=^)|(?<=\s))([a-z])\.\s+')
TOK_NUM = re.compile(r'(?:(?<=^)|(?<=\s))$(\d+)$\s+')
TOK_PAREN_LETTER = re.compile(r'(?:(?<=^)|(?<=\s))$([a-z])$\s+')
TOK_PAREN_CAP = re.compile(r'(?:(?<=^)|(?<=\s))$([A-Z])$\s+')

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
    # Join hyphenated line breaks and normalize whitespace
    text = re.sub(r'-\n', '', text)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    # Remove repeated spaces, keep single spaces
    text = re.sub(r'[ \t]+', ' ', text)
    # Trim each line
    text = '\n'.join(line.strip() for line in text.split('\n'))
    return text

# ---------------------------
# Parsing helpers
# ---------------------------

def split_inline_subparts(tail: str):
    # Split a heading's trailing text into base and inline subparts.
    # Returns list of (sub_id or None, text)
    out = []
    sub_letter = None
    sub_num = None
    sub_pl = None
    sub_pc = None

    i = 0
    buf = []

    def flush():
        txt = ''.join(buf).strip()
        if txt:
            sid = None
            if sub_letter:
                sid = sub_letter
                if sub_num is not None:
                    sid += f'({sub_num})'
                if sub_pl is not None:
                    sid += f'({sub_pl})'
                if sub_pc is not None:
                    sid += f'({sub_pc})'
            out.append((sid, txt))
        buf.clear()

    while i < len(tail):
        m = TOK_LETTER.match(tail, i)
        if m:
            flush()
            sub_letter = m.group(1)
            sub_num = None
            sub_pl = None
            sub_pc = None
            i = m.end()
            continue
        m = TOK_NUM.match(tail, i)
        if m and sub_letter:
            flush()
            sub_num = m.group(1)
            sub_pl = None
            sub_pc = None
            i = m.end()
            continue
        m = TOK_PAREN_LETTER.match(tail, i)
        if m and (sub_letter or sub_num is not None):
            flush()
            sub_pl = m.group(1)
            sub_pc = None
            i = m.end()
            continue
        m = TOK_PAREN_CAP.match(tail, i)
        if m and (sub_letter or sub_num is not None or sub_pl is not None):
            flush()
            sub_pc = m.group(1)
            i = m.end()
            continue
        buf.append(tail[i])
        i += 1
    flush()
    return out

def make_item(reg, para, sub, text):
    return {
        'regulation': reg,
        'paragraph': para,
        'subparagraph': sub,
        'text': text.strip()
    }

# ---------------------------
# Core parser
# ---------------------------

def parse_items(full_text: str):
    lines = full_text.split('\n')
    items = []
    current_para = None

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        # Ignore common headers/footers
        if line.startswith('AR 670–1 •') or line.startswith('AR 670-1 •'):
            continue

        # New paragraph heading?
        mh = PARA_HEADING.match(line)
        if mh:
            current_para = mh.group('para')
            tail = line[mh.end():].strip()

            if tail:
                for sub, text in split_inline_subparts(tail):
                    items.append(make_item(REGULATION_TITLE, current_para, sub, text))
            else:
                items.append(make_item(REGULATION_TITLE, current_para, None, ""))

            continue

        # Note lines stay within current paragraph
        if NOTE_LINE.match(line) and current_para:
            if items and items[-1]['paragraph'] == current_para:
                items[-1]['text'] = (items[-1]['text'] + ' ' + line).strip()
            else:
                items.append(make_item(REGULATION_TITLE, current_para, None, line))
            continue

        # Subpart lines within the current paragraph
        if current_para:
            m_letter = SUB_LETTER.match(line)
            if m_letter:
                sub = m_letter.group(1)  # 'a'
                text = line[m_letter.end():]
                items.append(make_item(REGULATION_TITLE, current_para, sub, text))
                continue

            m_num = SUB_NUM.match(line)
            if (m_num and items and
                items[-1]['paragraph'] == current_para and
                items[-1]['subparagraph'] and
                re.match(r'^[a-z]$', items[-1]['subparagraph'])):
                base = items[-1]['subparagraph']  # e.g., 'a'
                sub = f"{base}({m_num.group(1)})"
                text = line[m_num.end():]
                items.append(make_item(REGULATION_TITLE, current_para, sub, text))
                continue

            m_pl = SUB_PAREN_LETTER.match(line)
            if (m_pl and items and items[-1]['paragraph'] == current_para):
                last_sub = items[-1]['subparagraph']
                if last_sub and re.match(r'^[a-z]($\d+$)?$', last_sub):
                    sub = f"{last_sub}({m_pl.group(1)})"
                    text = line[m_pl.end():]
                    items.append(make_item(REGULATION_TITLE, current_para, sub, text))
                    continue

            m_pc = SUB_PAREN_CAP.match(line)
            if (m_pc and items and items[-1]['paragraph'] == current_para):
                last_sub = items[-1]['subparagraph']
                if last_sub and re.match(r'^[a-z]($\d+$)?($[a-z]$)?$', last_sub):
                    sub = f"{last_sub}({m_pc.group(1)})"
                    text = line[m_pc.end():]
                    items.append(make_item(REGULATION_TITLE, current_para, sub, text))
                    continue

            # Continuation of the last item in this paragraph
            if items and items[-1]['paragraph'] == current_para:
                items[-1]['text'] = (items[-1]['text'] + ' ' + line).strip()
                continue

        # If no current paragraph, ignore stray lines

    return items

# ---------------------------
# IO
# ---------------------------

def split_ar_pdf_to_json(pdf_path: str, out_path: str):
    raw = extract_text_from_pdf(pdf_path)
    norm = normalize_text(raw)
    items = parse_items(norm)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

# ---------------------------
# Entrypoint
# ---------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(0)  # do nothing silently
    pdf_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else f"{Path(pdf_path).stem}.json"
    split_ar_pdf_to_json(pdf_path, out_path)
