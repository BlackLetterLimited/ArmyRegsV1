#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ArmyRegs RAG (Two-stage retrieval + subparagraph chunking) using Ollama.

Features:
- Stage 1: Regulation routing using JSON1 (purpose + TOC)
- Stage 2: Hybrid retrieval within selected regs (keyword + FAISS embeddings)
- Subparagraph chunks (reg JSON already broken down by subparagraph)
- Acronym/context expansion from acronyms.json
- Strict citation gating: answers MUST quote controlling language, or refuse.

Requirements:
- Ollama running locally
- pip packages: faiss-cpu, numpy, rapidfuzz, requests

Usage:
  python armyregs_rag.py build-index \
    --router-json data/router.json \
    --acronyms-json data/acronyms.json \
    --regs-folder data/regs_json \
    --index-folder data/index

  python armyregs_rag.py ask \
    --router-json data/router.json \
    --acronyms-json data/acronyms.json \
    --regs-folder data/regs_json \
    --index-folder data/index
"""

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import requests
from rapidfuzz import fuzz

# FAISS import
try:
    import faiss  # type: ignore
except Exception as e:
    faiss = None


# -----------------------------
# Configuration Defaults
# -----------------------------

DEFAULT_OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")

# Models: you can change these
DEFAULT_CHAT_MODEL = os.environ.get("OLLAMA_CHAT_MODEL", "llama3.1:8b")
DEFAULT_EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# Retrieval settings
DEFAULT_ROUTE_TOP_N = 4           # how many regs to consider from router
DEFAULT_VECTOR_TOP_K = 30         # candidate chunks from FAISS
DEFAULT_KEYWORD_TOP_K = 30        # candidate chunks from keyword scoring
DEFAULT_FINAL_TOP_K = 10          # chunks passed to the answer model
DEFAULT_MAX_CONTEXT_CHARS = 22000 # keep context under control for local models

# Citation gating
MIN_REQUIRED_QUOTES = 1           # if 0 -> would allow answer without quotes (not recommended)


# -----------------------------
# Data Structures
# -----------------------------

@dataclass
class RegChunk:
    reg_number: str
    reg_title: str
    chapter: Optional[str]
    section: Optional[str]
    paragraph: str                 # e.g. "2-3"
    subparagraph: str              # e.g. "a(1)(b)"
    heading_path: str              # e.g. "Chapter 2 > Investigations > Appointment"
    text: str                      # authoritative text
    source_file: str               # file name for traceability

    def citation(self) -> str:
        # Customize to your preferred citation style
        sp = self.subparagraph.strip()
        if sp:
            return f"{self.reg_number}, para {self.paragraph}{sp}"
        return f"{self.reg_number}, para {self.paragraph}"

    def short_id(self) -> str:
        return f"{self.reg_number}|{self.paragraph}{self.subparagraph}".replace(" ", "")


# -----------------------------
# Utility Functions
# -----------------------------

def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def safe_lower(s: str) -> str:
    return (s or "").lower()


def truncate_text(s: str, max_chars: int) -> str:
    if len(s) <= max_chars:
        return s
    return s[:max_chars] + " ...[TRUNCATED]"


# -----------------------------
# Ollama Client
# -----------------------------

class OllamaClient:
    def __init__(self, host: str = DEFAULT_OLLAMA_HOST):
        self.host = host.rstrip("/")

    def embed(self, model: str, text: str) -> np.ndarray:
        """
        Calls Ollama embeddings endpoint.
        """
        url = f"{self.host}/api/embeddings"
        payload = {"model": model, "prompt": text}
        r = requests.post(url, json=payload, timeout=120)
        r.raise_for_status()
        data = r.json()
        vec = np.array(data["embedding"], dtype=np.float32)
        return vec

    def chat(self, model: str, system: str, user: str, temperature: float = 0.0) -> str:
        """
        Calls Ollama chat endpoint.
        """
        url = f"{self.host}/api/chat"
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "options": {
                "temperature": temperature,
            },
            "stream": False,
        }
        r = requests.post(url, json=payload, timeout=300)
        r.raise_for_status()
        data = r.json()
        return data["message"]["content"]


# -----------------------------
# Acronym / Context Expansion
# -----------------------------

def expand_query_with_acronyms(query: str, acronyms_json: Dict[str, Any]) -> str:
    """
    Expands query by replacing/adding expansions for acronyms and including optional context terms.

    Expected acronyms.json structure example:
    {
      "acronyms": {
        "IO": "investigating officer",
        "TPU": "troop program unit"
      },
      "synonyms": {
        "appoint": ["designate", "detail", "assign"],
        "investigation": ["administrative investigation", "AR 15-6 investigation"]
      }
    }
    """
    q = query.strip()

    acr = acronyms_json.get("acronyms", {}) if isinstance(acronyms_json, dict) else {}
    syn = acronyms_json.get("synonyms", {}) if isinstance(acronyms_json, dict) else {}

    # Add expansions for explicit acronyms found as whole tokens
    tokens = re.findall(r"[A-Za-z0-9\-]+", q)
    expansions = []
    for t in tokens:
        if t in acr:
            expansions.append(f"{t} ({acr[t]})")

    # Add synonym expansions if keywords appear
    syn_expansions = []
    q_lower = safe_lower(q)
    for key, alts in syn.items():
        if safe_lower(key) in q_lower and isinstance(alts, list):
            syn_expansions.extend(alts)

    # Combine
    extra = []
    if expansions:
        extra.append("Acronym expansions: " + "; ".join(expansions))
    if syn_expansions:
        extra.append("Related terms: " + "; ".join(sorted(set(syn_expansions))))

    if not extra:
        return q

    return q + "\n\n" + "\n".join(extra)


# -----------------------------
# Load Regulation Chunks
# -----------------------------

def load_regulation_chunks(reg_json_path: Path) -> List[RegChunk]:
    """
    Loads a single regulation JSON file that is already broken into subparagraph chunks.

    Expected structure per file (example):
    {
      "reg_number": "AR 15-6",
      "reg_title": "Procedures for Administrative Investigations and Boards of Officers",
      "source": {"filename": "AR_15-6.pdf", "version_date": "2016-04-01"},
      "chunks": [
        {
          "chapter": "2",
          "section": "2-3",
          "paragraph": "2-3",
          "subparagraph": "a(1)",
          "heading_path": "Chapter 2 > Appointment > Investigating officers",
          "text": "The appointing authority will..."
        }
      ]
    }
    """
    obj = read_json(reg_json_path)

    reg_number = obj.get("reg_number", "").strip()
    reg_title = obj.get("reg_title", "").strip()
    source = obj.get("source", {}) or {}
    source_file = source.get("filename", reg_json_path.name)

    chunks_raw = obj.get("chunks", [])
    out: List[RegChunk] = []

    for c in chunks_raw:
        text = normalize_ws(c.get("text", ""))
        if not text:
            continue

        out.append(
            RegChunk(
                reg_number=reg_number,
                reg_title=reg_title,
                chapter=(c.get("chapter") or None),
                section=(c.get("section") or None),
                paragraph=str(c.get("paragraph", "")).strip(),
                subparagraph=str(c.get("subparagraph", "")).strip(),
                heading_path=str(c.get("heading_path", "")).strip(),
                text=text,
                source_file=str(source_file),
            )
        )

    return out


# -----------------------------
# Router (JSON1) Regulation Selection
# -----------------------------

def score_router_entry(question: str, entry: Dict[str, Any]) -> float:
    """
    Scores a router entry using fuzzy matching against purpose + toc + keywords.
    This is a simple, transparent router. You can later replace with an LLM router.
    """
    q = normalize_ws(question)
    ql = safe_lower(q)

    reg_number = str(entry.get("reg_number", ""))
    title = str(entry.get("title", ""))
    purpose = str(entry.get("purpose", ""))
    toc = " ".join(entry.get("toc", [])) if isinstance(entry.get("toc", []), list) else str(entry.get("toc", ""))

    keywords = entry.get("keywords", [])
    if isinstance(keywords, list):
        kw_blob = " ".join([str(k) for k in keywords])
    else:
        kw_blob = str(keywords)

    blob = normalize_ws(f"{reg_number} {title} {purpose} {toc} {kw_blob}")

    # Weighted fuzzy matching
    score = 0.0
    score += 0.40 * fuzz.token_set_ratio(ql, safe_lower(title))
    score += 0.35 * fuzz.token_set_ratio(ql, safe_lower(purpose))
    score += 0.20 * fuzz.token_set_ratio(ql, safe_lower(toc))
    score += 0.05 * fuzz.token_set_ratio(ql, safe_lower(kw_blob))

    # Small bonus if reg number explicitly referenced (e.g., "AR 15-6")
    if safe_lower(reg_number) in ql:
        score += 10.0

    return score


def route_regulations(question: str, router_json: Dict[str, Any], top_n: int = DEFAULT_ROUTE_TOP_N) -> List[Dict[str, Any]]:
    """
    Returns top router entries (reg candidates).
    Expected router.json structure:
    {
      "regs": [
        {"reg_number": "AR 15-6", "title": "...", "purpose": "...", "toc": [...], "keywords": [...]},
        ...
      ]
    }
    """
    regs = router_json.get("regs", [])
    if not isinstance(regs, list) or not regs:
        raise ValueError("router.json missing 'regs' list.")

    scored = []
    for e in regs:
        try:
            s = score_router_entry(question, e)
        except Exception:
            s = 0.0
        scored.append((s, e))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for _, e in scored[:top_n]]


# -----------------------------
# Index Building (FAISS per reg)
# -----------------------------

def build_faiss_index(vectors: np.ndarray) -> "faiss.IndexFlatIP":
    """
    Build cosine-similarity FAISS index via inner product on normalized vectors.
    """
    if faiss is None:
        raise RuntimeError("faiss not installed. Install faiss-cpu.")

    # Normalize for cosine similarity
    faiss.normalize_L2(vectors)

    dim = vectors.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(vectors)
    return index


def save_faiss_index(index_path: Path, index: "faiss.Index") -> None:
    index_path.parent.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(index_path))


def load_faiss_index(index_path: Path) -> "faiss.Index":
    if faiss is None:
        raise RuntimeError("faiss not installed. Install faiss-cpu.")
    return faiss.read_index(str(index_path))


def index_folder_for_reg(index_folder: Path, reg_number: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9\-_.]+", "_", reg_number.strip())
    return index_folder / safe


def build_indexes(
    router_json_path: Path,
    regs_folder: Path,
    index_folder: Path,
    embed_model: str,
    ollama: OllamaClient,
) -> None:
    """
    Builds FAISS vector indexes for each regulation JSON in regs_folder.

    Outputs per regulation:
      index.faiss
      meta.json  (chunks metadata and texts)
      embeddings.npy
    """
    if not regs_folder.exists():
        raise FileNotFoundError(f"regs_folder not found: {regs_folder}")

    reg_files = sorted(regs_folder.glob("*.json"))
    if not reg_files:
        raise FileNotFoundError(f"No regulation JSON files found in {regs_folder}")

    index_folder.mkdir(parents=True, exist_ok=True)

    for reg_path in reg_files:
        chunks = load_regulation_chunks(reg_path)
        if not chunks:
            print(f"[SKIP] No chunks in {reg_path.name}")
            continue

        reg_number = chunks[0].reg_number or reg_path.stem
        out_dir = index_folder_for_reg(index_folder, reg_number)
        out_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n[INDEX] {reg_number} ({len(chunks)} chunks)")

        # Prepare texts for embedding
        # Include headings and citation in the embedding text to improve retrieval
        embed_texts = []
        for ch in chunks:
            embed_texts.append(
                normalize_ws(
                    f"{ch.reg_number} {ch.reg_title} | {ch.heading_path} | {ch.citation()} | {ch.text}"
                )
            )

        # Embed in batches
        vectors = []
        batch_size = 16
        for i in range(0, len(embed_texts), batch_size):
            batch = embed_texts[i:i + batch_size]
            for t in batch:
                v = ollama.embed(embed_model, t)
                vectors.append(v)
            print(f"  embedded {min(i+batch_size, len(embed_texts))}/{len(embed_texts)}", end="\r")
        print()

        vecs = np.vstack(vectors).astype(np.float32)
        index = build_faiss_index(vecs)

        # Save
        save_faiss_index(out_dir / "index.faiss", index)
        np.save(out_dir / "embeddings.npy", vecs)

        meta = []
        for ch in chunks:
            meta.append({
                "reg_number": ch.reg_number,
                "reg_title": ch.reg_title,
                "chapter": ch.chapter,
                "section": ch.section,
                "paragraph": ch.paragraph,
                "subparagraph": ch.subparagraph,
                "heading_path": ch.heading_path,
                "text": ch.text,
                "source_file": ch.source_file,
            })
        write_json(out_dir / "meta.json", meta)

        print(f"  saved index -> {out_dir}")

    print("\n[DONE] Index build complete.")


# -----------------------------
# Retrieval (Hybrid)
# -----------------------------

def keyword_score(query: str, chunk: RegChunk) -> float:
    """
    Lightweight keyword scoring using fuzzy matching over chunk text + heading path.
    """
    q = safe_lower(normalize_ws(query))
    blob = safe_lower(normalize_ws(f"{chunk.heading_path} {chunk.text} {chunk.citation()}"))

    # token_set_ratio is good for legal text
    return float(fuzz.token_set_ratio(q, blob))


def retrieve_chunks_for_reg(
    question: str,
    reg_number: str,
    index_folder: Path,
    embed_model: str,
    ollama: OllamaClient,
    vector_top_k: int = DEFAULT_VECTOR_TOP_K,
    keyword_top_k: int = DEFAULT_KEYWORD_TOP_K,
    final_top_k: int = DEFAULT_FINAL_TOP_K,
) -> List[RegChunk]:
    """
    Loads FAISS index + meta for a regulation and returns top relevant chunks.
    """
    reg_dir = index_folder_for_reg(index_folder, reg_number)
    meta_path = reg_dir / "meta.json"
    index_path = reg_dir / "index.faiss"

    if not meta_path.exists() or not index_path.exists():
        raise FileNotFoundError(f"Missing index for {reg_number}. Expected: {meta_path} and {index_path}")

    meta = read_json(meta_path)
    index = load_faiss_index(index_path)

    # Build RegChunk list
    chunks: List[RegChunk] = []
    for m in meta:
        chunks.append(
            RegChunk(
                reg_number=m["reg_number"],
                reg_title=m.get("reg_title", ""),
                chapter=m.get("chapter"),
                section=m.get("section"),
                paragraph=m.get("paragraph", ""),
                subparagraph=m.get("subparagraph", ""),
                heading_path=m.get("heading_path", ""),
                text=m.get("text", ""),
                source_file=m.get("source_file", ""),
            )
        )

    # Vector search
    qvec = ollama.embed(embed_model, question).astype(np.float32).reshape(1, -1)
    faiss.normalize_L2(qvec)
    scores, idxs = index.search(qvec, min(vector_top_k, len(chunks)))
    vec_candidates = [(int(i), float(s)) for i, s in zip(idxs[0], scores[0]) if i >= 0]

    # Keyword candidates
    kw_scored = [(i, keyword_score(question, chunks[i])) for i in range(len(chunks))]
    kw_scored.sort(key=lambda x: x[1], reverse=True)
    kw_candidates = kw_scored[:min(keyword_top_k, len(kw_scored))]

    # Merge candidates
    combined: Dict[int, float] = {}

    # Vector scores are cosine similarity ~ [-1..1], keyword ~ [0..100]
    # Normalize vector into 0..100-ish
    for i, s in vec_candidates:
        combined[i] = combined.get(i, 0.0) + (s * 100.0)

    for i, s in kw_candidates:
        combined[i] = combined.get(i, 0.0) + s

    merged = sorted(combined.items(), key=lambda x: x[1], reverse=True)
    top_idxs = [i for i, _ in merged[:min(final_top_k, len(merged))]]

    return [chunks[i] for i in top_idxs]


def retrieve_across_regs(
    question: str,
    selected_regs: List[str],
    index_folder: Path,
    embed_model: str,
    ollama: OllamaClient,
    final_top_k_total: int = 12,
) -> List[RegChunk]:
    """
    Retrieves across multiple regs and returns top chunks overall.
    """
    all_chunks: List[Tuple[RegChunk, float]] = []

    for reg in selected_regs:
        try:
            chunks = retrieve_chunks_for_reg(
                question=question,
                reg_number=reg,
                index_folder=index_folder,
                embed_model=embed_model,
                ollama=ollama,
                vector_top_k=DEFAULT_VECTOR_TOP_K,
                keyword_top_k=DEFAULT_KEYWORD_TOP_K,
                final_top_k=DEFAULT_FINAL_TOP_K,
            )
        except Exception as e:
            print(f"[WARN] Retrieval failed for {reg}: {e}")
            continue

        # Score again for global ranking
        for ch in chunks:
            s = keyword_score(question, ch)
            all_chunks.append((ch, s))

    all_chunks.sort(key=lambda x: x[1], reverse=True)
    dedup = []
    seen = set()
    for ch, s in all_chunks:
        sid = ch.short_id()
        if sid in seen:
            continue
        seen.add(sid)
        dedup.append(ch)
        if len(dedup) >= final_top_k_total:
            break

    return dedup


# -----------------------------
# Answer Generation (Citation-Gated)
# -----------------------------

def build_context_block(chunks: List[RegChunk], max_chars: int = DEFAULT_MAX_CONTEXT_CHARS) -> str:
    """
    Builds a context block for the LLM. We include citation + heading + quoted text.
    """
    parts = []
    for i, ch in enumerate(chunks, start=1):
        parts.append(
            f"[SOURCE {i}]\n"
            f"Regulation: {ch.reg_number} — {ch.reg_title}\n"
            f"Citation: {ch.citation()}\n"
            f"Heading: {ch.heading_path}\n"
            f"Text: \"{ch.text}\"\n"
        )
    ctx = "\n".join(parts)
    return truncate_text(ctx, max_chars)


def answer_with_citations(
    question: str,
    chunks: List[RegChunk],
    chat_model: str,
    ollama: OllamaClient,
) -> str:
    """
    Produces a legal-review response. Hard rule: only answer from provided sources.
    """
    system = (
        "You are an Army regulations legal reviewer. You MUST follow these rules:\n"
        "1) Use ONLY the provided sources. Do NOT use outside knowledge.\n"
        "2) Every legal rule statement MUST be supported by a direct quote from the sources.\n"
        "3) You MUST include citations to the exact paragraph/subparagraph.\n"
        "4) If the sources do not contain sufficient information to answer, say so and explain what is missing.\n"
        "5) Do NOT hallucinate. Do NOT guess. Do NOT invent citations.\n"
        "6) Provide a structured response: Issue, Rule (quoted), Analysis, Conclusion, Missing Facts (if any).\n"
    )

    context = build_context_block(chunks)

    user = (
        f"USER QUESTION:\n{question}\n\n"
        f"PROVIDED REGULATORY SOURCES:\n{context}\n\n"
        "Write the response now."
    )

    return ollama.chat(chat_model, system=system, user=user, temperature=0.0)


def enforce_citation_gating(answer: str, chunks: List[RegChunk]) -> Tuple[bool, str]:
    """
    Simple gating check: ensure the answer includes at least MIN_REQUIRED_QUOTES occurrences of quotes
    and includes at least one of the citations.
    This is not perfect, but prevents many failures.

    You can strengthen this later by:
    - requiring citations exactly match known citations
    - requiring bracketed source IDs, etc.
    """
    quote_count = answer.count("\"")
    has_quotes = quote_count >= (MIN_REQUIRED_QUOTES * 2)  # each quote uses two "
    known_citations = [c.citation() for c in chunks]
    has_any_citation = any(cit in answer for cit in known_citations)

    if has_quotes and has_any_citation:
        return True, answer

    refusal = (
        "I cannot answer your question from the retrieved Army Regulation text with sufficient citation support.\n\n"
        "Reason: The retrieved sources did not provide a clearly controlling quoted rule and matching citation.\n\n"
        "Recommended next steps:\n"
        "1) Expand the regulation set searched, or increase top-k retrieval.\n"
        "2) Provide the suspected regulation number and paragraph.\n"
        "3) Clarify key facts (component, duty status, commander level, etc.).\n"
    )
    return False, refusal


# -----------------------------
# CLI Commands
# -----------------------------

def cmd_build_index(args: argparse.Namespace) -> None:
    router_json_path = Path(args.router_json)
    regs_folder = Path(args.regs_folder)
    index_folder = Path(args.index_folder)

    if not router_json_path.exists():
        raise FileNotFoundError(f"router_json not found: {router_json_path}")

    if not regs_folder.exists():
        raise FileNotFoundError(f"regs_folder not found: {regs_folder}")

    ollama = OllamaClient(host=args.ollama_host)

    # Just validate router loads (not required for indexing, but helpful)
    _ = read_json(router_json_path)

    build_indexes(
        router_json_path=router_json_path,
        regs_folder=regs_folder,
        index_folder=index_folder,
        embed_model=args.embed_model,
        ollama=ollama,
    )


def cmd_ask(args: argparse.Namespace) -> None:
    router_json_path = Path(args.router_json)
    acronyms_json_path = Path(args.acronyms_json)
    regs_folder = Path(args.regs_folder)
    index_folder = Path(args.index_folder)

    if not router_json_path.exists():
        raise FileNotFoundError(f"router_json not found: {router_json_path}")
    if not acronyms_json_path.exists():
        raise FileNotFoundError(f"acronyms_json not found: {acronyms_json_path}")
    if not regs_folder.exists():
        raise FileNotFoundError(f"regs_folder not found: {regs_folder}")
    if not index_folder.exists():
        raise FileNotFoundError(f"index_folder not found: {index_folder}")

    router_json = read_json(router_json_path)
    acronyms_json = read_json(acronyms_json_path)

    ollama = OllamaClient(host=args.ollama_host)

    print("\nArmyRegs RAG is ready. Type a question (or 'exit').\n")

    while True:
        try:
            q = input("Question> ").strip()
        except KeyboardInterrupt:
            print("\nExiting.")
            return

        if not q:
            continue
        if q.lower() in ("exit", "quit", "q"):
            return

        # Expand question using acronyms/context
        expanded_q = expand_query_with_acronyms(q, acronyms_json)

        # Stage 1 routing
        candidates = route_regulations(expanded_q, router_json, top_n=args.route_top_n)
        selected_regs = [c.get("reg_number") for c in candidates if c.get("reg_number")]

        print("\n[Routing] Selected regulations:")
        for c in candidates:
            print(f"  - {c.get('reg_number')}: {c.get('title')}")

        # Stage 2 retrieval across selected regs
        chunks = retrieve_across_regs(
            question=expanded_q,
            selected_regs=selected_regs,
            index_folder=index_folder,
            embed_model=args.embed_model,
            ollama=ollama,
            final_top_k_total=args.final_top_k_total,
        )

        if not chunks:
            print("\nNo relevant chunks retrieved. Try increasing top-k or adding regulations.\n")
            continue

        # Answer
        raw_answer = answer_with_citations(
            question=q,
            chunks=chunks,
            chat_model=args.chat_model,
            ollama=ollama,
        )

        ok, final_answer = enforce_citation_gating(raw_answer, chunks)

        print("\n" + "=" * 80)
        print(final_answer)
        print("=" * 80 + "\n")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ArmyRegs RAG (Ollama + JSON + FAISS)")

    sub = p.add_subparsers(dest="command", required=True)

    p_build = sub.add_parser("build-index", help="Build FAISS indexes for each regulation JSON")
    p_build.add_argument("--router-json", required=True)
    p_build.add_argument("--acronyms-json", required=False, default="data/acronyms.json")
    p_build.add_argument("--regs-folder", required=True)
    p_build.add_argument("--index-folder", required=True)
    p_build.add_argument("--ollama-host", default=DEFAULT_OLLAMA_HOST)
    p_build.add_argument("--embed-model", default=DEFAULT_EMBED_MODEL)
    p_build.set_defaults(func=cmd_build_index)

    p_ask = sub.add_parser("ask", help="Ask questions using the built indexes")
    p_ask.add_argument("--router-json", required=True)
    p_ask.add_argument("--acronyms-json", required=True)
    p_ask.add_argument("--regs-folder", required=True)
    p_ask.add_argument("--index-folder", required=True)
    p_ask.add_argument("--ollama-host", default=DEFAULT_OLLAMA_HOST)
    p_ask.add_argument("--embed-model", default=DEFAULT_EMBED_MODEL)
    p_ask.add_argument("--chat-model", default=DEFAULT_CHAT_MODEL)
    p_ask.add_argument("--route-top-n", type=int, default=DEFAULT_ROUTE_TOP_N)
    p_ask.add_argument("--final-top-k-total", type=int, default=12)
    p_ask.set_defaults(func=cmd_ask)

    return p


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
