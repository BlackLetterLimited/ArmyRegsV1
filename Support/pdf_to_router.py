#!/usr/bin/env python3
import sys
import os
import re
import json
from PyPDF2 import PdfReader


# ---------------------------
# Helpers
# ---------------------------

def normalize_text(s: str) -> str:
    """Normalize dash variants and collapse whitespace."""
    if not s:
        return ""
    s = s.replace("–", "-").replace("—", "-")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_reg_number(s: str) -> str:
    """
    Normalize regulation number strings:
      '600 - 8 - 19' -> '600-8-19'
      '600 – 8 – 19' -> '600-8-19'
    """
    s = normalize_text(s)
    s = re.sub(r"\s*-\s*", "-", s)
    return s


def extract_lines_from_pdf(pdf_path, page_num=None):
    """
    Extract normalized lines from PDF.
    If page_num is None => all pages.
    If page_num is int => only that page (0-based).
    """
    reader = PdfReader(pdf_path)

    if page_num is not None:
        pages = [reader.pages[page_num]]
    else:
        pages = reader.pages

    text = ""
    for page in pages:
        text += (page.extract_text() or "") + "\n"

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines


def is_noise_title_line(line: str) -> bool:
    """Filters out lines that are obviously not regulation titles."""
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

    # Looks like a date line
    if re.fullmatch(r"\d{1,2}\s+[A-Za-z]+\s+\d{4}", line.strip()):
        return True

    # Mostly numbers/punctuation
    if re.fullmatch(r"[\d\W]+", line.strip()):
        return True

    # No letters => not a title
    if not re.search(r"[A-Za-z]", line):
        return True

    return False


def looks_like_series_header(line: str) -> bool:
    """
    Many ARs have a series/category header line between the AR number and real title,
    e.g. "Personnel-General", "Personnel-General", "Training and Education", etc.

    We detect the common pattern: two words/phrases separated by a dash.
    """
    if not line:
        return False

    l = normalize_text(line)

    # Example: "Personnel-General" or "Personnel - General"
    if re.match(r"^[A-Za-z]+(\s+[A-Za-z]+)*\s*-\s*[A-Za-z]+(\s+[A-Za-z]+)*$", l):
        return True

    return False


# ---------------------------
# Metadata (first page only)
# ---------------------------

def extract_regulation_and_title(first_page_lines):
    regulation = ""
    title = ""
    version_date = ""

    joined_raw = "\n".join(first_page_lines)
    joined_norm = normalize_text(joined_raw)

    reg_patterns = [
        re.compile(
            r"\bArmy Regulation\s*([0-9]{1,3}(?:\s*-\s*[0-9]{1,3}){1,3})\b",
            re.IGNORECASE
        ),
        re.compile(
            r"\bAR\s*([0-9]{1,3}(?:\s*-\s*[0-9]{1,3}){1,3})\b",
            re.IGNORECASE
        ),
    ]

    reg_num = ""
    for pat in reg_patterns:
        m = pat.search(joined_norm)
        if m:
            reg_num = normalize_reg_number(m.group(1))
            break

    if reg_num:
        regulation = reg_num

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

    # ---------------- TITLE DETECTION ----------------

    def looks_like_header_noise(line: str) -> bool:
        ln = line.strip()
        if not ln:
            return True

        ln_norm = normalize_text(ln)

        # Lines that contain the reg number itself (like "AR 600-52 • 11 February 2025")
        if re.search(r"\bAR\b", ln, re.IGNORECASE) and re.search(r"\d", ln):
            return True
        if re.search(r"\bArmy Regulation\b", ln, re.IGNORECASE):
            return True

        # HQ/location/date/summary/etc.
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

        # Your existing noise heuristics
        if is_noise_title_line(ln):
            return True

        return False

    # Find anchor line that has the regulation text (but we won't use that line as title)
    anchor_idx = None
    for i, line in enumerate(first_page_lines):
        if (re.search(r"\bArmy Regulation\b", line, re.IGNORECASE) or
                re.search(r"\bAR\b", line, re.IGNORECASE)):
            anchor_idx = i
            break

    candidates = []
    if anchor_idx is not None:
        # Start AFTER the reg/date line
        for j in range(anchor_idx + 1, min(anchor_idx + 30, len(first_page_lines))):
            cand_raw = first_page_lines[j].strip()
            cand = cand_raw  # keep original for title; normalize only for tests
            cand_norm = normalize_text(cand)

            if looks_like_header_noise(cand):
                if candidates:
                    break
                continue

            # stop when we hit a clearly prose paragraph (long + ends with period)
            if len(cand) > 120 and cand.rstrip().endswith("."):
                break

            candidates.append(cand)

    if candidates:
        # Optional: skip series header if you like
        start_idx = 0
        if looks_like_series_header(candidates[0]) and len(candidates) >= 2:
            start_idx = 1

        # Take up to 3 lines as the title block
        title_lines = candidates[start_idx:start_idx + 3]
        title = " ".join(title_lines).strip()
        title = re.sub(r"\s+", " ", title)

    return regulation, title, version_date



# ---------------------------
# Purpose (1-1 to 1-2)
# ---------------------------

def extract_purpose(all_lines):
    """
    Capture everything between 1-1 (Purpose) and 1-2.
    """
    norm_lines = [normalize_text(l) for l in all_lines]

    start_idx = None
    for i, l in enumerate(norm_lines):
        if re.match(r"^1\s*-\s*1\.?\s*Purpose\b", l, re.IGNORECASE):
            start_idx = i
            break
        if re.match(r"^1\s*-\s*1\s+Purpose\b", l, re.IGNORECASE):
            start_idx = i
            break

    if start_idx is None:
        return ""

    end_idx = None
    for i in range(start_idx + 1, len(norm_lines)):
        if re.match(r"^1\s*-\s*2\b", norm_lines[i], re.IGNORECASE):
            end_idx = i
            break

    if end_idx is None:
        end_idx = len(norm_lines)

    purpose_body = norm_lines[start_idx + 1:end_idx]
    return " ".join(purpose_body).strip()


# ---------------------------
# TOC extraction (flat, no pages)
# ---------------------------

def extract_toc_flat(all_lines):
    """
    Extract a flat TOC list WITHOUT page numbers.

    Produces entries like:
      {"type":"chapter", "chapter":"1", "title":"Introduction"}
      {"type":"paragraph", "chapter":"1", "paragraph":"1-1", "title":"Purpose"}
    """
    toc = []

    toc_start = next((i for i, l in enumerate(all_lines)
                      if re.search(r"\bContents\b", l, re.IGNORECASE)), None)
    if toc_start is None:
        return toc

    stop_pattern = re.compile(r"^(Appendices|Glossary)\b", re.IGNORECASE)
    chapter_header = re.compile(r"^Chapter\s+(\d+)\b", re.IGNORECASE)

    # Paragraph entry one line bullet:
    para_bullet = re.compile(
        r"^(.*?)\s*[•\u2022]\s*(\d+)\s*-\s*(\d+)\s*,\s*page\s*\d+\s*$",
        re.IGNORECASE
    )
    # Paragraph entry one line dotted leader:
    para_dotted = re.compile(
        r"^(.*?)\s*(?:\.{2,}|\.\s\.\s\.\s\.\s\.)\s*(\d+)\s*-\s*(\d+)\s*,\s*page\s*\d+\s*$",
        re.IGNORECASE
    )
    # Signature-only line (multi-line continuation):
    para_sig_only = re.compile(
        r"^(?:[•\u2022]\s*)?(\d+)\s*-\s*(\d+)\s*,\s*page\s*\d+\s*$",
        re.IGNORECASE
    )

    page_pattern = re.compile(r"\bpage\s*\d+\s*$", re.IGNORECASE)

    i = toc_start + 1
    pending_title = None
    current_chapter = None

    while i < len(all_lines):
        raw = all_lines[i].strip()
        line = normalize_text(raw)

        if stop_pattern.search(line):
            break

        if re.match(r"^Summary of Change$", line, re.IGNORECASE):
            i += 1
            continue

        # ----------------- CHAPTER HANDLING (improved multi-line) -----------------
        m_chap = chapter_header.match(line)
        if m_chap:
            current_chapter = m_chap.group(1)
            pending_title = None

            # Collect subsequent lines until we hit one that contains "page N"
            j = i + 1
            title_lines = []
            while j < len(all_lines):
                cand_raw = all_lines[j].strip()
                cand = normalize_text(cand_raw)
                if not cand:
                    j += 1
                    continue

                # If we hit another chapter header or stop area, bail out
                if chapter_header.match(cand) or stop_pattern.search(cand):
                    break

                # If this line has "page N" at the end, treat everything before ", page"
                # as the last part of the title and stop.
                m_page = re.search(r"(.*?),\s*page\s*\d+\s*$", cand, re.IGNORECASE)
                if m_page:
                    if m_page.group(1).strip():
                        title_lines.append(m_page.group(1).strip())
                    j += 1
                    break
                else:
                    title_lines.append(cand)
                    j += 1

            # Build chapter title if we collected anything
            if title_lines:
                # Join with spaces; normalize double spaces
                chapter_title = " ".join(title_lines).strip()
                chapter_title = re.sub(r"\s+", " ", chapter_title)
                toc.append({
                    "type": "chapter",
                    "chapter": current_chapter,
                    "title": chapter_title,
                })

            i = j
            continue
        # -------------------------------------------------------------------------

        # FULL paragraph entry on one line (bullet)
        m_para = para_bullet.match(line)
        if m_para:
            title = m_para.group(1).strip()
            major = m_para.group(2)
            minor = m_para.group(3)

            toc.append({
                "type": "paragraph",
                "chapter": major,
                "paragraph": f"{major}-{minor}",
                "title": title
            })
            pending_title = None
            i += 1
            continue

        # FULL paragraph entry on one line (dotted)
        m_para2 = para_dotted.match(line)
        if m_para2:
            title = m_para2.group(1).strip()
            major = m_para2.group(2)
            minor = m_para2.group(3)

            toc.append({
                "type": "paragraph",
                "chapter": major,
                "paragraph": f"{major}-{minor}",
                "title": title
            })
            pending_title = None
            i += 1
            continue

        # Signature-only line with pending title
        m_sig = para_sig_only.match(line)
        if m_sig and pending_title:
            major = m_sig.group(1)
            minor = m_sig.group(2)

            toc.append({
                "type": "paragraph",
                "chapter": major,
                "paragraph": f"{major}-{minor}",
                "title": pending_title.strip()
            })
            pending_title = None
            i += 1
            continue

        # Store a likely wrapped TOC title line for paragraphs
        if re.search(r"[A-Za-z]", line) and 3 <= len(line) <= 160:
            if not page_pattern.search(line):
                pending_title = line

        i += 1

    return toc



def build_nested_toc(flat_toc):
    """
    Convert flat TOC list into nested structure:
    [
      {
        "chapter": "1",
        "title": "Introduction",
        "paragraphs": [
          {"paragraph": "1-1", "title": "Purpose"},
          ...
        ]
      }
    ]
    """
    nested = []
    current = None

    for entry in flat_toc:
        if entry.get("type") == "chapter":
            current = {
                "chapter": entry["chapter"],
                "title": entry.get("title", ""),
                "paragraphs": []
            }
            nested.append(current)

        elif entry.get("type") == "paragraph":
            if current is None:
                current = {
                    "chapter": entry.get("chapter", ""),
                    "title": "",
                    "paragraphs": []
                }
                nested.append(current)

            current["paragraphs"].append({
                "paragraph": entry.get("paragraph", ""),
                "title": entry.get("title", "")
            })

    return nested


# ---------------------------
# Main
# ---------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 pdf_to_router.py <pdf_path>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.isfile(pdf_path):
        print(f"File not found: {pdf_path}")
        sys.exit(1)

    # Extract first page only for regulation/title/date
    first_page_lines = extract_lines_from_pdf(pdf_path, page_num=0)
    # Extract full document for purpose + TOC
    all_lines = extract_lines_from_pdf(pdf_path, page_num=None)

    regulation, title, version_date = extract_regulation_and_title(first_page_lines)
    purpose = extract_purpose(all_lines)

    flat_toc = extract_toc_flat(all_lines)
    nested_toc = build_nested_toc(flat_toc)

    regulation_obj = {
        "regulation": regulation,
        "title": title,
        "version_date": version_date,
        "purpose": purpose,
        "table_of_contents": nested_toc
    }

    output = {
        "regulations": [regulation_obj]
    }

    # Ensure output folder exists
    out_folder = "./data/router_json"
    os.makedirs(out_folder, exist_ok=True)

    safe_reg = regulation if regulation else "UNKNOWN_AR"
    safe_reg = safe_reg.replace(" ", "_")
    out_filename = f"{safe_reg}_ROUT.json"
    out_path = os.path.join(out_folder, out_filename)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"JSON saved to {out_path}")


if __name__ == "__main__":
    main()
