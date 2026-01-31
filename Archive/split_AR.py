#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
import json
import sys
from pathlib import Path
import pdfplumber

# ---------------------------
# Detection and configuration
# ---------------------------

DEFAULT_REGULATION_LABEL = "AR"  # fallback family if detection fails

# Normalize various dash types to '-'
DASHES = dict.fromkeys(map(ord, "–—‑−"), "-")

DA_PAM_PATTERNS = [
    r'\bDA\s*PAM\b',
    r'\bDA\s*PAMPHLET\b',
    r'\bDEPARTMENT OF THE ARMY PAMPHLET\b',
    r'\bDAPAM\b'
]
AR_PATTERNS = [
    r'\bARMY\s+REGULATION\b',
    r'(^|[\s_-])AR([\s_-]|$)',
    r'\bAR\s+\d'
]

# Examples to match: "AR 670-1", "AR 25–50", "DA PAM 670-1", "DA Pamphlet 600–3"
REG_NUMBER_RE = re.compile(
    r'\b(?P<label>(?:AR|ARMY\s+REGULATION|DA\s*PAM|DA\s*PAMPHLET|DEPARTMENT OF THE ARMY PAMPHLET))'
    r'\s*'
    r'(?P<num>\d{1,4}\s*[-–—]\s*\d{1,4})\b',
    flags=re.IGNORECASE
)

# Paragraph ID: "3-7", "3–7", or "3—7", optional trailing dot.
PARA_ID_RE = r'(?P<para>\d{1,3}[-–—]\d{1,3})(?:\.)?'

# Heading detector: start of line, paragraph ID, then space/end/heading punctuation.
PARA_HEADING = re.compile(rf'^{PARA_ID_RE}(?=\s|$|[:;—–-])')

NOTE_LINE = re.compile(r'^(Note[s]?[:\.])\s', flags=re.IGNORECASE)

# Subpart tokens at line start
SUB_LETTER = re.compile(r'^([a-z])\.\s+')
SUB_NUM = re.compile(r'^$(\d+)$\s+')
SUB_PAREN_LETTER = re.compile(r'^$([a-z])$\s+')
SUB_PAREN_CAP = re.compile(r'^$([A-Z])$\s+')

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
    # normalize dashes first
    text = text.translate(DASHES)
    # Join hyphenated line breaks and normalize whitespace
    text = re.sub(r'-\n', '', text)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    # Remove repeated spaces, keep single spaces
    text = re.sub(r'[ \t]+', ' ', text)
    # Trim each line
    text = '\n'.join(line.strip() for line in text.split('\n'))
    return text

# ---------------------------
# Detection helpers (family + number)
# ---------------------------

def infer_family_from_text(text: str) -> str:
    T = text.upper()
    for pat in DA_PAM_PATTERNS:
        if re.search(pat, T):
            return "DA PAM"
    for pat in AR_PATTERNS:
        if re.search(pat, T):
            return "AR"
    return DEFAULT_REGULATION_LABEL

def infer_family_from_filename(path: str) -> str:
    n = Path(path).name.upper()
    if any(s in n for s in ["DA PAM", "DA_PAM", "DA-PAM", "DAPAM", "DA PAMPHLET"]):
        return "DA PAM"
    if "ARMY REGULATION" in n or re.search(r'(^|[\s_-])AR([\s_-]|$)', n):
        return "AR"
    return DEFAULT_REGULATION_LABEL

def extract_label_number_from_text(text: str):
    # Look near the beginning first (cover/first page)
    head = "\n".join(text.splitlines()[:150])  # first ~150 lines
    for blob in (head, text):
        m = REG_NUMBER_RE.search(blob)
        if m:
            label_raw = m.group('label').upper().replace("  ", " ").strip()
            num = m.group('num').replace(" ", "")
            num = num.translate(DASHES)  # ensure "-"
            # Normalize label to either "AR" or "DA PAM"
            if "PAMPHLET" in label_raw or "DA PAM" in label_raw or "DEPARTMENT OF THE ARMY PAMPHLET" in label_raw:
                label = "DA PAM"
            elif "ARMY REGULATION" in label_raw or label_raw == "AR":
                label = "AR"
            else:
                label = infer_family_from_text(text)
            return f"{label} {num}"
    return None

def infer_regulation_label(pdf_path: str, norm_text: str) -> str:
    # Prefer explicit label+number from the text
    full = extract_label_number_from_text(norm_text)
    if full:
        return full
    # Otherwise infer family then try to scrape a standalone number near title-like lines
    family = infer_family_from_text(norm_text)
    if family == DEFAULT_REGULATION_LABEL:
        family = infer_family_from_filename(pdf_path)

    # Try to find a plausible number pattern even if label not shown
    num_match = re.search(r'\b(\d{1,4}\s*-\s*\d{1,4})\b', "\n".join(norm_text.splitlines()[:150]))
    if num_match:
        num = num_match.group(1).replace(" ", "")
        return f"{family} {num}"
    return family  # fallback to just "AR" or "DA PAM"

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

def make_item(regulation_full, para, sub, text):
    return {
        'regulation': regulation_full,  # e.g., "AR 670-1" or "DA PAM 670-1"
        'paragraph': para,
        'subparagraph': sub,
        'text': text.strip()
    }

# ---------------------------
# Core parser
# ---------------------------

def parse_items(full_text: str, regulation_full: str):
    lines = full_text.split('\n')
    items = []
    current_para = None

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        # Ignore common headers/footers (handles AR and DA PAM variants)
        u = line.upper()
        if (u.startswith('AR ') and ' •' in line) or \
           u.startswith('DA PAM ') or \
           u.startswith('DA PAMPHLET ') or \
           u.startswith('DEPARTMENT OF THE ARMY PAMPHLET'):
            continue

        # New paragraph heading?
        mh = PARA_HEADING.match(line)
        if mh:
            current_para = mh.group('para').translate(DASHES)
            tail = line[mh.end():].strip()

            if tail:
                for sub, text in split_inline_subparts(tail):
                    items.append(make_item(regulation_full, current_para, sub, text))
            else:
                items.append(make_item(regulation_full, current_para, None, ""))
            continue

        # Note lines stay within current paragraph
        if NOTE_LINE.match(line) and current_para:
            if items and items[-1]['paragraph'] == current_para:
                items[-1]['text'] = (items[-1]['text'] + ' ' + line).strip()
            else:
                items.append(make_item(regulation_full, current_para, None, line))
            continue

        # Subpart lines within the current paragraph
        if current_para:
            m_letter = SUB_LETTER.match(line)
            if m_letter:
                sub = m_letter.group(1)  # 'a'
                text = line[m_letter.end():]
                items.append(make_item(regulation_full, current_para, sub, text))
                continue

            m_num = SUB_NUM.match(line)
            if (m_num and items and
                items[-1]['paragraph'] == current_para and
                items[-1]['subparagraph'] and
                re.match(r'^[a-z]$', items[-1]['subparagraph'])):
                base = items[-1]['subparagraph']  # e.g., 'a'
                sub = f"{base}({m_num.group(1)})"
                text = line[m_num.end():]
                items.append(make_item(regulation_full, current_para, sub, text))
                continue

            m_pl = SUB_PAREN_LETTER.match(line)
            if (m_pl and items and items[-1]['paragraph'] == current_para):
                last_sub = items[-1]['subparagraph']
                if last_sub and re.match(r'^[a-z]($\d+$)?$', last_sub):
                    sub = f"{last_sub}({m_pl.group(1)})"
                    text = line[m_pl.end():]
                    items.append(make_item(regulation_full, current_para, sub, text))
                    continue

            m_pc = SUB_PAREN_CAP.match(line)
            if (m_pc and items and items[-1]['paragraph'] == current_para):
                last_sub = items[-1]['subparagraph']
                if last_sub and re.match(r'^[a-z]($\d+$)?($[a-z]$)?$', last_sub):
                    sub = f"{last_sub}({m_pc.group(1)})"
                    text = line[m_pc.end():]
                    items.append(make_item(regulation_full, current_para, sub, text))
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

    # Infer "regulation" field, including family and number if available
    regulation_full = infer_regulation_label(pdf_path, norm)  # e.g., "AR 670-1" or "DA PAM 670-1"

    items = parse_items(norm, regulation_full)
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