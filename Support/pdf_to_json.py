#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
PDF -> Army Regulation JSON builder (subparagraph-based chunks)

Enhancements:
- Subparagraph chunking by structure (not token size)
- Correct sibling handling: c(1), c(2), c(3) (no c(1)(2))
- Lead-in propagation (e.g., "will-", "as follows:")
- Page metadata per chunk (page_start, page_end)

Dependency:
  pip install pymupdf
"""

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Dict

import fitz  # PyMuPDF


# -----------------------------
# Utility helpers
# -----------------------------

def normalize_dashes(s: str) -> str:
    return s.replace("–", "-").replace("—", "-").replace("−", "-")


def normalize_ws(s: str) -> str:
    s = s.replace("\u00a0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def normalize_text(s: str) -> str:
    if not s:
        return ""
    s = normalize_dashes(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_reg_number(s: str) -> str:
    s = normalize_text(s)
    s = re.sub(r"\s*-\s*", "-", s)
    return s


def looks_like_header_or_footer(line: str) -> bool:
    l = line.strip()
    if not l:
        return True
    if re.fullmatch(r"\d+", l):
        return True
    if "army regulation" in l.lower():
        return True
    if re.search(r"\bAR\s+\d+-\d+\b", l) and re.search(r"\b\d{4}\b", l):
        return True
    return False


# -----------------------------
# Regex definitions
# -----------------------------

CHAPTER_RE = re.compile(r"^Chapter\s+(\d+)", re.IGNORECASE)

PARA_RE = re.compile(r"^(?P<num>\d{1,2}\s*-\s*\d{1,3})\.\s*(?P<title>.*)$")

SUB_A_RE = re.compile(r"^(?P<label>[a-z])\.\s+(?P<rest>.*)$")
SUB_1_RE = re.compile(r"^\((?P<label>\d{1,2})\)\s+(?P<rest>.*)$")
SUB_PAREN_A_RE = re.compile(r"^\((?P<label>[a-z])\)\s+(?P<rest>.*)$")

LEAD_IN_RE = re.compile(
    r"(will-|will:|will—|as follows:|the following:|includes:)$",
    re.IGNORECASE,
)


# -----------------------------
# PDF extraction
# -----------------------------

def extract_lines(pdf_path: Path):
    """
    Returns list of dicts:
      { "text": line, "page": page_number }
    """
    doc = fitz.open(str(pdf_path))
    out = []

    for i, page in enumerate(doc):
        page_no = i + 1
        text = normalize_dashes(page.get_text("text"))
        for line in text.splitlines():
            if looks_like_header_or_footer(line):
                continue
            out.append({
                "text": line.rstrip(),
                "page": page_no
            })

    return out


def _first_pages_text(pdf_path: Path, max_pages: int = 2) -> str:
    doc = fitz.open(str(pdf_path))
    texts = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        texts.append(normalize_dashes(page.get_text("text")))
    return "\n".join(texts)


def _extract_reg_metadata_from_text(text: str):
    lines = [normalize_ws(l) for l in text.splitlines() if normalize_ws(l)]
    joined_raw = "\n".join(lines)
    joined_norm = normalize_text(joined_raw)

    reg_number = None
    reg_title = None
    version_date = None

    date_re = re.compile(r"\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b")

    reg_patterns = [
        re.compile(
            r"\bArmy Regulation\s*([0-9]{1,3}(?:\s*-\s*[0-9]{1,3}){1,3})\b",
            re.IGNORECASE,
        ),
        re.compile(
            r"\bAR\s*([0-9]{1,3}(?:\s*-\s*[0-9]{1,3}){1,3})\b",
            re.IGNORECASE,
        ),
    ]

    for pat in reg_patterns:
        m = pat.search(joined_norm)
        if m:
            reg_number = normalize_reg_number(m.group(1))
            break

    if reg_number:
        reg_number = reg_number.strip()

    eff = re.search(
        r"\bEffective\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b",
        joined_raw,
        re.IGNORECASE,
    )
    if eff:
        version_date = eff.group(1).strip()

    if not version_date:
        hqda = re.search(
            r"Washington,\s*DC\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
            joined_raw,
            re.IGNORECASE,
        )
        if hqda:
            version_date = hqda.group(1).strip()

    def is_noise_title_line(line: str) -> bool:
        if not line:
            return True
        low = line.strip().lower()
        noise_prefixes = (
            "headquarters",
            "department of the army",
            "washington",
            "unclassified",
            "summary of change",
            "history",
            "effective",
            "contents",
            "this regulation",
        )
        if any(low.startswith(p) for p in noise_prefixes):
            return True
        if re.fullmatch(r"\d{1,2}\s+[A-Za-z]+\s+\d{4}", line.strip()):
            return True
        if re.fullmatch(r"[\d\W]+", line.strip()):
            return True
        if not re.search(r"[A-Za-z]", line):
            return True
        return False

    def looks_like_series_header(line: str) -> bool:
        if not line:
            return False
        l = normalize_text(line)
        if re.match(r"^[A-Za-z]+(\s+[A-Za-z]+)*\s*-\s*[A-Za-z]+(\s+[A-Za-z]+)*$", l):
            return True
        return False

    def looks_like_header_noise(line: str) -> bool:
        ln = line.strip()
        if not ln:
            return True
        ln_norm = normalize_text(ln)
        if re.search(r"\bAR\b", ln, re.IGNORECASE) and re.search(r"\d", ln):
            return True
        if re.search(r"\bArmy Regulation\b", ln, re.IGNORECASE):
            return True
        if re.search(r"\bHeadquarters\b", ln, re.IGNORECASE):
            return True
        if re.search(r"\bDepartment of the Army\b", ln, re.IGNORECASE):
            return True
        if re.search(r"\bWashington,\s*DC\b", ln, re.IGNORECASE):
            return True
        if re.search(r"\bEffective\b", ln, re.IGNORECASE):
            return True
        if re.search(r"\bSUMMARY of CHANGE\b", ln, re.IGNORECASE):
            return True
        if ln_norm.startswith("summary"):
            return True
        if re.fullmatch(r"\d{1,2}\s+[A-Za-z]+\s+\d{4}", ln):
            return True
        if is_noise_title_line(ln):
            return True
        return False

    anchor_idx = None
    for i, line in enumerate(lines):
        if (re.search(r"\bArmy Regulation\b", line, re.IGNORECASE) or
                re.search(r"\bAR\b", line, re.IGNORECASE)):
            anchor_idx = i
            break

    candidates = []
    if anchor_idx is not None:
        for j in range(anchor_idx + 1, min(anchor_idx + 30, len(lines))):
            cand = lines[j].strip()
            if looks_like_header_noise(cand):
                if candidates:
                    break
                continue
            if len(cand) > 120 and cand.rstrip().endswith("."):
                break
            candidates.append(cand)

    if candidates:
        start_idx = 0
        if looks_like_series_header(candidates[0]) and len(candidates) >= 2:
            start_idx = 1
        title_lines = candidates[start_idx:start_idx + 3]
        reg_title = " ".join(title_lines).strip()
        reg_title = re.sub(r"\s+", " ", reg_title)

    return reg_number, reg_title, version_date


def extract_reg_metadata(pdf_path: Path):
    text = _first_pages_text(pdf_path, max_pages=2)
    return _extract_reg_metadata_from_text(text)


# -----------------------------
# State and chunk builder
# -----------------------------

@dataclass
class CursorState:
    chapter: Optional[str] = None
    paragraph: Optional[str] = None
    heading_stack: List[str] = field(default_factory=list)
    sub_chain: List[str] = field(default_factory=list)
    lead_in_text: Optional[str] = None


def chain_to_label(chain: List[str]) -> str:
    return "".join(chain)


def reset_after_letter(letter: str) -> List[str]:
    return [letter]


def set_numeric(chain: List[str], num: str) -> List[str]:
    base = []
    for t in chain:
        if t.startswith("("):
            break
        base.append(t)
    return base + [f"({num})"]


def set_paren_letter(chain: List[str], letter: str) -> List[str]:
    if chain and re.fullmatch(r"\([a-z]\)", chain[-1]):
        return chain[:-1] + [f"({letter})"]
    return chain + [f"({letter})"]


@dataclass
class ChunkBuilder:
    reg_number: str
    reg_title: str
    source_filename: str
    version_date: Optional[str]
    chunks: List[Dict] = field(default_factory=list)

    def flush(
        self,
        state: CursorState,
        buffer: List[str],
        page_start: Optional[int],
        page_end: Optional[int],
    ):
        text = normalize_ws("\n".join(buffer))
        if not text or not state.paragraph:
            return

        if state.lead_in_text:
            text = f"{state.lead_in_text} {text}"

        self.chunks.append({
            "chapter": state.chapter,
            "paragraph": state.paragraph,
            "subparagraph": chain_to_label(state.sub_chain),
            "heading_path": " > ".join(state.heading_stack),
            "page_start": page_start,
            "page_end": page_end,
            "text": text,
        })


# -----------------------------
# Main parsing logic
# -----------------------------

def build_chunks(lines, builder: ChunkBuilder):
    state = CursorState()
    buffer = []
    page_start = None
    page_end = None

    def is_hard_wrap_paragraph_ref() -> bool:
        if not buffer:
            return False
        tail = buffer[-1].rstrip()
        return bool(re.search(r"\bpara(graph)?-?$", tail, re.IGNORECASE))

    def flush():
        nonlocal buffer, page_start, page_end
        builder.flush(state, buffer, page_start, page_end)
        buffer = []
        page_start = None
        page_end = None

    for item in lines:
        line = item["text"].strip()
        page = item["page"]

        if not line:
            continue

        if page_start is None:
            page_start = page
        page_end = page

        # Chapter
        m = CHAPTER_RE.match(line)
        if m:
            flush()
            state.chapter = m.group(1)
            state.heading_stack = [f"Chapter {state.chapter}"]
            state.sub_chain = []
            state.lead_in_text = None
            continue

        # Paragraph
        m = PARA_RE.match(line)
        if m:
            # If the previous line ended with "paragraph"/"para-", this is likely
            # a hard-wrapped reference (e.g., "paragraph 2-6.") not a new heading.
            if is_hard_wrap_paragraph_ref():
                buffer.append(line)
                continue
            flush()
            state.paragraph = m.group("num").replace(" ", "")
            title = m.group("title")
            state.heading_stack = [f"Chapter {state.chapter}", f"{state.paragraph}. {title}"]
            state.sub_chain = []
            state.lead_in_text = None
            continue

        # a.
        m = SUB_A_RE.match(line)
        if m:
            flush()
            state.sub_chain = reset_after_letter(m.group("label"))
            state.lead_in_text = None
            buffer.append(m.group("rest"))
            continue

        # (1)
        m = SUB_1_RE.match(line)
        if m:
            flush()
            state.sub_chain = set_numeric(state.sub_chain, m.group("label"))
            state.lead_in_text = None
            buffer.append(m.group("rest"))
            continue

        # (a)
        m = SUB_PAREN_A_RE.match(line)
        if m:
            flush()
            state.sub_chain = set_paren_letter(state.sub_chain, m.group("label"))
            state.lead_in_text = None
            buffer.append(m.group("rest"))
            continue

        # Continuation
        buffer.append(line)

        # Lead-in detection
        if LEAD_IN_RE.search(line):
            state.lead_in_text = normalize_ws(" ".join(buffer))
            buffer = []

    flush()


# -----------------------------
# CLI
# -----------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--out")
    ap.add_argument("--reg-number")
    ap.add_argument("--reg-title")
    ap.add_argument("--version-date")

    args = ap.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)

    auto_reg_number, auto_reg_title, auto_version_date = extract_reg_metadata(pdf_path)
    reg_number = args.reg_number or auto_reg_number
    reg_title = args.reg_title or auto_reg_title
    version_date = args.version_date or auto_version_date

    if not reg_number or not reg_title:
        raise ValueError(
            "Could not infer reg number/title from PDF. Provide --reg-number and --reg-title."
        )

    out_path = args.out
    if not out_path:
        safe_reg = reg_number.replace(" ", "")
        out_path = str(Path(__file__).parent / "data" / "regs_json" / f"{safe_reg}.json")

    lines = extract_lines(pdf_path)

    builder = ChunkBuilder(
        reg_number=reg_number,
        reg_title=reg_title,
        source_filename=pdf_path.name,
        version_date=version_date,
    )

    build_chunks(lines, builder)

    output = {
        "reg_number": builder.reg_number,
        "reg_title": builder.reg_title,
        "source": {
            "filename": builder.source_filename,
            "version_date": builder.version_date,
        },
        "chunks": builder.chunks,
    }

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"[OK] Wrote {len(builder.chunks)} chunks to {out_path}")


if __name__ == "__main__":
    main()
