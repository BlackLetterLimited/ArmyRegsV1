#!/usr/bin/env python3
"""
retrieve_test.py

Goal: Two-stage, multi-granularity retrieval over regs_combined.json
1) Retrieve "context" nodes (aggregates + paragraph-level) to land in the right neighborhood.
2) Expand to leaf subparagraphs (for precise citations) using provenance and sibling rules.
3) Rerank leaf candidates and output leaf extracts with exact citations.

This script is a retrieval test harness (no LLM calls).
"""

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from llama_index.core import Document, Settings, StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core.postprocessor import SentenceTransformerRerank


# -------------------------
# Config (tune as needed)
# -------------------------

EMBED_MODEL = "BAAI/bge-base-en-v1.5"
RERANK_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
INDEX_CACHE_DIR = ".rag_index_cache"

VEC_TOP_K = 60
BM25_TOP_K = 25
RERANK_TOP_N_CONTEXT = 15
RERANK_TOP_N_LEAF = 25

DEFAULT_OUTPUT_TOP = 20

MAX_LEAF_POOL = 250
MAX_LEAF_PER_PARAGRAPH = 100


# -------------------------
# Helpers
# -------------------------

def _display_reg(reg: str) -> str:
    r = (reg or "").strip()
    if not r:
        return r
    if r.lower().startswith("ar "):
        return r
    return f"AR {r}"


def _format_citation(reg: str, para: str, sub: Optional[str]) -> str:
    reg_disp = _display_reg(reg)
    if not para:
        return reg_disp
    if sub:
        s = sub.strip()
        # Ensure dot before first parenthetical if missing: "a(1)" -> "a.(1)"
        if "(" in s and ".(" not in s:
            idx = s.find("(")
            if idx > 0 and s[idx - 1].isalnum():
                s = s[:idx] + "." + s[idx:]
        return f"{reg_disp} para {para}.{s}"
    return f"{reg_disp} para {para}"


def _normalize_ws(text: str) -> str:
    return re.sub(r"[ \t]+\n", "\n", (text or "")).strip()


def _is_aggregated_chunk(ch: Dict[str, Any]) -> bool:
    sub = (ch.get("subparagraph") or "").strip()
    if ch.get("is_aggregated") is True:
        return True
    if sub.endswith("(full)") or sub.endswith(".(full)"):
        return True
    return False


def _question_type(q: str) -> str:
    s = (q or "").lower()
    if any(k in s for k in ("who can", "who may", "who is authorized", "who is allowed", "appoint", "appointed", "serve as")):
        return "eligibility"
    if any(k in s for k in ("exception", "waiver", "unless", "exigenc", "except")):
        return "exceptions"
    if any(k in s for k in ("define", "definition", "what is", "meaning of")):
        return "definitions"
    if any(k in s for k in ("how", "procedure", "steps", "process", "when must", "timeline", "deadline")):
        return "procedure"
    return "general"


def _augment_query(q: str) -> str:
    s = (q or "").strip()
    s_low = s.lower()
    expansions: List[str] = []

    if re.search(r"\bio\b", s_low) or "investigating officer" in s_low:
        expansions.append("IO investigating officer")
    if "15-6" in s_low and "ar" not in s_low:
        expansions.append("AR 15-6 administrative investigation")
    if "appoint" in s_low or "appointing authority" in s_low:
        expansions.append("appointing authority appointing official may appoint")
    if "board" in s_low or "investigation" in s_low:
        expansions.append("administrative investigations boards of officers")

    if expansions:
        return s + "\n\nQuery expansion:\n" + "\n".join(f"- {e}" for e in expansions)
    return s


# -------------------------
# JSON loading
# -------------------------

def load_chunks(json_path: str) -> List[Dict[str, Any]]:
    raw = json.loads(Path(json_path).read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "chunks" in raw:
        reg = (raw.get("reg_number") or raw.get("regulation") or raw.get("reg") or "").strip()
        chunks = raw.get("chunks") or []
        for ch in chunks:
            ch.setdefault("regulation", reg)
        return chunks
    if isinstance(raw, list):
        return raw
    raise ValueError("Unsupported JSON structure. Expected list or dict with 'chunks'.")


def build_lookup(chunks: List[Dict[str, Any]]) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    lookup: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for ch in chunks:
        reg = _display_reg((ch.get("regulation") or ch.get("reg") or "").strip())
        para = (ch.get("paragraph") or ch.get("section") or "").strip()
        sub = (ch.get("subparagraph") or "").strip()
        if not (reg and para and ch.get("text")):
            continue
        lookup[(reg, para, sub)] = ch
    return lookup


def iter_documents(
    chunks: List[Dict[str, Any]],
    *,
    node_filter: Optional[str] = None,
) -> List[Document]:
    """
    node_filter:
      - None: include all nodes
      - "context": include aggregated + paragraph-level (empty subparagraph)
      - "leaf": include non-aggregated leaf nodes
    """
    docs: List[Document] = []
    for ch in chunks:
        reg = _display_reg((ch.get("regulation") or ch.get("reg") or "").strip())
        para = (ch.get("paragraph") or ch.get("section") or "").strip()
        sub = (ch.get("subparagraph") or "").strip()
        text = _normalize_ws(ch.get("text") or "")
        if not (reg and para and text):
            continue

        is_agg = _is_aggregated_chunk(ch)
        if node_filter == "context":
            if not (is_agg or sub == ""):
                continue
        if node_filter == "leaf":
            if is_agg:
                continue

        heading_path = (ch.get("heading_path") or "").strip()
        para_id = _format_citation(reg, para, sub if sub else None)

        header = f"{reg} {para}" + (f" {sub}" if sub else "")
        parts = [header]
        if heading_path:
            parts.append(heading_path)
        parts.append(text)
        indexed_text = "\n".join(p for p in parts if p).strip()

        docs.append(
            Document(
                text=indexed_text,
                metadata={
                    "reg": reg,
                    "para": para,
                    "sub": sub,
                    "para_id": para_id,
                    "heading_path": heading_path,
                    "node_kind": "context" if is_agg or sub == "" else "leaf",
                    "is_aggregated": is_agg,
                    "source_subparagraphs": ch.get("source_subparagraphs") or [],
                },
            )
        )
    return docs


# -------------------------
# Retrieval utilities
# -------------------------

def _node_md(n) -> Dict[str, Any]:
    md = getattr(n, "metadata", None)
    if md is not None:
        return md
    node = getattr(n, "node", None)
    return getattr(node, "metadata", None) if node is not None else {}


def _node_key(n) -> Tuple[str, str, str]:
    md = _node_md(n) or {}
    return (md.get("reg", ""), md.get("para", ""), md.get("sub", ""))


def _unique_nodes(nodes):
    seen = set()
    out = []
    for n in nodes:
        k = _node_key(n)
        if k in seen:
            continue
        seen.add(k)
        out.append(n)
    return out


def _rrf_fuse(lists, k: int = 60):
    scores: Dict[Tuple[str, str, str], float] = {}
    nodes_by_key = {}
    for lst in lists:
        for rank, n in enumerate(lst, start=1):
            key = _node_key(n)
            nodes_by_key.setdefault(key, n)
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
    fused = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [nodes_by_key[k] for k, _ in fused]


def expand_from_context_hits(
    context_nodes,
    chunks_lookup: Dict[Tuple[str, str, str], Dict[str, Any]],
    question: str,
) -> List[Dict[str, Any]]:
    qtype = _question_type(question)
    leaf_chunks: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    def _has_child_sub(reg: str, para: str, sub: str) -> bool:
        if not sub:
            return False
        prefix = f"{sub}("
        for (r, p, s) in chunks_lookup.keys():
            if r == reg and p == para and s.startswith(prefix):
                return True
        return False

    def _has_sibling_sub(reg: str, para: str, sub: str) -> bool:
        base = sub.split("(", 1)[0] if "(" in sub else sub
        for (r, p, s) in chunks_lookup.keys():
            if r != reg or p != para or not s or s == sub:
                continue
            if s == base or s.startswith(base + "("):
                return True
        return False

    def add_leaf(reg: str, para: str, sub: str):
        if not sub:
            key = (reg, para, sub)
            ch = chunks_lookup.get(key)
            if not ch or _is_aggregated_chunk(ch):
                return
            leaf_chunks[key] = ch
            return
        if sub.endswith("(full)") and _has_sibling_sub(reg, para, sub):
            return
        if re.fullmatch(r"[a-z]{1,2}", sub) and _has_child_sub(reg, para, sub):
            return
        key = (reg, para, sub)
        ch = chunks_lookup.get(key)
        if not ch:
            return
        if _is_aggregated_chunk(ch):
            return
        leaf_chunks[key] = ch

    def add_paragraph_siblings(reg: str, para: str):
        subs = [sub for (r, p, sub) in chunks_lookup.keys() if r == reg and p == para and sub]
        subs = subs[:MAX_LEAF_PER_PARAGRAPH]

        if qtype == "eligibility":
            wanted_prefixes = ("a", "b", "e", "c")
            for sub in subs:
                if any(sub == w or sub.startswith(w + "(") for w in wanted_prefixes):
                    add_leaf(reg, para, sub)
            return

        if qtype == "exceptions":
            for sub in subs:
                ch = chunks_lookup.get((reg, para, sub))
                if not ch or _is_aggregated_chunk(ch):
                    continue
                t = (ch.get("text") or "").lower()
                if any(k in t for k in ("except", "unless", "exigenc", "waiver", "impractic")):
                    add_leaf(reg, para, sub)
            return

        if qtype == "definitions":
            for sub in subs:
                ch = chunks_lookup.get((reg, para, sub))
                if not ch or _is_aggregated_chunk(ch):
                    continue
                t = (ch.get("text") or "").lower()
                if any(k in t for k in ("means", "definition", "defined")):
                    add_leaf(reg, para, sub)
            return

        for sub in subs:
            if re.fullmatch(r"[a-z]{1,2}(\(\d+\))?", sub):
                add_leaf(reg, para, sub)

    for n in context_nodes:
        md = _node_md(n) or {}
        reg = (md.get("reg") or "").strip()
        para = (md.get("para") or "").strip()
        sub = (md.get("sub") or "").strip()
        if not (reg and para):
            continue

        src = md.get("source_subparagraphs") or []
        if src:
            for s in src:
                add_leaf(reg, para, s)

        # If this is a paragraph-level node (sub == ""), add paragraph siblings
        add_paragraph_siblings(reg, para)

        # If the context node itself is a leaf (no subparagraphs), keep it
        if sub == "" and (reg, para, sub) in chunks_lookup:
            add_leaf(reg, para, sub)

    leaf_list = list(leaf_chunks.values())
    if len(leaf_list) > MAX_LEAF_POOL:
        leaf_list = leaf_list[:MAX_LEAF_POOL]
    return leaf_list


def chunk_to_document(ch: Dict[str, Any]) -> Document:
    reg = _display_reg((ch.get("regulation") or ch.get("reg") or "").strip())
    para = (ch.get("paragraph") or ch.get("section") or "").strip()
    sub = (ch.get("subparagraph") or "").strip()
    heading_path = (ch.get("heading_path") or "").strip()
    text = _normalize_ws(ch.get("text") or "")
    para_id = _format_citation(reg, para, sub if sub else None)

    header = f"{reg} {para}" + (f" {sub}" if sub else "")
    parts = [header]
    if heading_path:
        parts.append(heading_path)
    parts.append(text)
    indexed_text = "\n".join(p for p in parts if p).strip()

    return Document(
        text=indexed_text,
        metadata={
            "reg": reg,
            "para": para,
            "sub": sub,
            "para_id": para_id,
            "heading_path": heading_path,
            "node_kind": "leaf",
            "is_aggregated": False,
        },
    )


# -------------------------
# Main
# -------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="regs_combined.json", help="Path to combined regulations JSON")
    ap.add_argument("--q", required=True, help="User query")
    ap.add_argument("--top", type=int, default=DEFAULT_OUTPUT_TOP, help="How many leaf extracts to output")
    ap.add_argument("--rebuild", action="store_true", help="Force rebuild index cache")
    ap.add_argument("--embed-model", default=EMBED_MODEL, help="Embedding model name")
    ap.add_argument("--rerank-model", default=RERANK_MODEL, help="Reranker model name")
    ap.add_argument("--no-rerank", action="store_true", help="Skip cross-encoder reranking")
    ap.add_argument("--no-bm25", action="store_true", help="Disable BM25 hybrid retrieval")
    ap.add_argument("--timing", action="store_true", help="Print timing breakdown to stderr")
    ap.add_argument("--show-context", action="store_true", help="Include context hits in output JSON")
    args = ap.parse_args()

    json_path = Path(args.json)
    if not json_path.exists():
        raise FileNotFoundError(str(json_path))

    def _t():
        return time.perf_counter()

    def _log(stage: str, t0: float):
        if args.timing:
            dt = _t() - t0
            print(f"[timing] {stage}: {dt:.3f}s", file=sys.stderr)

    t0 = _t()
    Settings.embed_model = HuggingFaceEmbedding(model_name=args.embed_model)
    _log("load embed model", t0)
    reranker_context = None
    reranker_leaf = None
    if not args.no_rerank:
        t0 = _t()
        reranker_context = SentenceTransformerRerank(model=args.rerank_model, top_n=RERANK_TOP_N_CONTEXT)
        reranker_leaf = SentenceTransformerRerank(model=args.rerank_model, top_n=RERANK_TOP_N_LEAF)
        _log("load reranker model", t0)

    t0 = _t()
    chunks = load_chunks(str(json_path))
    lookup = build_lookup(chunks)
    _log("load+lookup chunks", t0)

    # Build / load context index
    t0 = _t()
    context_docs = iter_documents(chunks, node_filter="context")
    _log("build context documents", t0)

    cache_root = Path(INDEX_CACHE_DIR)
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_sig_src = "|".join([
        str(json_path.stat().st_mtime_ns),
        args.embed_model,
        "context_only_no_split",
    ])
    cache_sig = hashlib.md5(cache_sig_src.encode("utf-8")).hexdigest()[:12]
    cache_dir = cache_root / f"{json_path.stem}_ctx_{cache_sig}"

    t0 = _t()
    if cache_dir.exists() and not args.rebuild:
        storage_context = StorageContext.from_defaults(persist_dir=str(cache_dir))
        context_index = load_index_from_storage(storage_context)
    else:
        context_index = VectorStoreIndex.from_documents(context_docs)
        context_index.storage_context.persist(persist_dir=str(cache_dir))
    _log("load/build context index", t0)

    # Hybrid retrieval over context nodes
    t0 = _t()
    retriever_vec = context_index.as_retriever(similarity_top_k=VEC_TOP_K)
    bm25 = None
    if not args.no_bm25:
        try:
            from llama_index.core.retrievers import BM25Retriever
            bm25 = BM25Retriever.from_defaults(docstore=context_index.docstore, similarity_top_k=BM25_TOP_K)
        except Exception:
            bm25 = None
    _log("init context retrievers", t0)

    q_aug = _augment_query(args.q)

    t0 = _t()
    nodes_vec = retriever_vec.retrieve(q_aug)
    nodes_bm25 = bm25.retrieve(q_aug) if bm25 else []
    nodes_fused = _rrf_fuse([nodes_vec, nodes_bm25]) if nodes_bm25 else nodes_vec
    nodes_fused = _unique_nodes(nodes_fused)
    _log("retrieve context", t0)

    t0 = _t()
    if reranker_context:
        nodes_ctx = reranker_context.postprocess_nodes(nodes_fused, query_str=q_aug)
        nodes_ctx = _unique_nodes(nodes_ctx)
    else:
        nodes_ctx = nodes_fused
    _log("rerank context", t0)

    # Expand to leaf pool
    t0 = _t()
    leaf_pool_chunks = expand_from_context_hits(nodes_ctx, lookup, args.q)
    _log("expand leaf pool", t0)

    # If expansion is sparse, fall back to top leaf hits from full set
    if len(leaf_pool_chunks) < 8:
        for ch in chunks:
            if _is_aggregated_chunk(ch):
                continue
            leaf_pool_chunks.append(ch)
            if len(leaf_pool_chunks) >= 200:
                break

    # Build a temporary index over leaf pool for final selection
    t0 = _t()
    leaf_docs = [chunk_to_document(ch) for ch in leaf_pool_chunks]
    leaf_index = VectorStoreIndex.from_documents(leaf_docs)
    leaf_retriever = leaf_index.as_retriever(similarity_top_k=min(60, max(args.top * 3, 30)))
    _log("build leaf index", t0)

    t0 = _t()
    leaf_nodes = leaf_retriever.retrieve(q_aug)
    _log("retrieve leaf", t0)
    t0 = _t()
    if reranker_leaf:
        leaf_nodes = reranker_leaf.postprocess_nodes(leaf_nodes, query_str=q_aug)
        leaf_nodes = _unique_nodes(leaf_nodes)
    _log("rerank leaf", t0)

    # Output
    out_top = max(1, args.top)
    results = []
    for n in leaf_nodes[:out_top]:
        md = _node_md(n) or {}
        node_obj = getattr(n, "node", n)
        txt = node_obj.get_content() if hasattr(node_obj, "get_content") else getattr(node_obj, "text", "")
        results.append(
            {
                "para_id": md.get("para_id") or _format_citation(md.get("reg", ""), md.get("para", ""), md.get("sub") or None),
                "regulation": md.get("reg", ""),
                "paragraph": md.get("para", ""),
                "subparagraph": md.get("sub", "") or None,
                "heading_path": md.get("heading_path", ""),
                "text": _normalize_ws(txt),
            }
        )

    payload = {"query": args.q, "retrieved_leaf_extracts": results}
    if args.show_context:
        ctx = []
        for n in nodes_ctx[: min(15, len(nodes_ctx))]:
            md = _node_md(n) or {}
            ctx.append(
                {
                    "para_id": md.get("para_id") or _format_citation(md.get("reg", ""), md.get("para", ""), md.get("sub") or None),
                    "regulation": md.get("reg", ""),
                    "paragraph": md.get("para", ""),
                    "subparagraph": md.get("sub", "") or None,
                    "heading_path": md.get("heading_path", ""),
                    "is_aggregated": bool(md.get("is_aggregated")),
                }
            )
        payload["context_hits"] = ctx

    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
