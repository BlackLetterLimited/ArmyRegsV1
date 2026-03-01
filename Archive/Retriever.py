#!/usr/bin/env python3
"""
Hierarchical / dual-granularity RAG retrieval for Army Regulations JSON.

Goal:
- Retrieve "context nodes" (aggregates) to land in the right neighborhood.
- Deterministically expand to leaf subparagraphs for precise quoting/citation.
- Re-rank leaf candidates and output a list of leaf regulation extracts.

Usage:
  python3 retriever.py --json regs_combined.json --q "who can serve as an IO in a 15-6" --top 20

Notes:
- This script does NOT call an LLM. It only retrieves and outputs extracts.
- It avoids SentenceSplitter; each JSON chunk is treated as an atomic node.
- Requires llama-index and sentence-transformers models available locally.
"""

import argparse
import json
import re
import hashlib
import time
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Set

from llama_index.core import Settings, VectorStoreIndex, Document, StorageContext, load_index_from_storage
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core.postprocessor import SentenceTransformerRerank


# -------------------------
# Config (tune as needed)
# -------------------------

# Best-in-class general embedding for English semantic retrieval (strong recall/precision trade).
# If you have GPU, "BAAI/bge-large-en-v1.5" is excellent. If CPU-only and too slow, swap to "BAAI/bge-base-en-v1.5".
EMBED_MODEL = "BAAI/bge-base-en-v1.5"

# "BAAI/bge-reranker-large" is very strong cross-encoder reranker; improves "answer-shaped vs controlling" ranking.
# If too slow, swap to: "cross-encoder/ms-marco-MiniLM-L-6-v2"
RERANK_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"

INDEX_CACHE_DIR = ".rag_index_cache"

# Retrieval knobs
VEC_TOP_K = 60
BM25_TOP_K = 25
RERANK_TOP_N_CONTEXT = 15
RERANK_TOP_N_LEAF = 25

# Output knobs
DEFAULT_OUTPUT_TOP = 20

# Expansion caps (to keep contexts tight)
MAX_LEAF_POOL = 250
MAX_LEAF_PER_PARAGRAPH = 80


# -------------------------
# Helpers
# -------------------------

def _display_reg(reg: str) -> str:
    r = (reg or "").strip()
    if not r:
        return r
    if r.lower().startswith("ar "):
        return r
    # If already "15-6", display as "AR 15-6"
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
    """
    Lightweight router. Add more as you like.
    """
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
    """
    Add high-value synonym expansions for Army regs.
    Keep minimal to avoid noise.
    """
    s = (q or "").strip()
    s_low = s.lower()

    expansions: List[str] = []
    # IO acronym expansion
    if re.search(r"\bio\b", s_low) or "investigating officer" in s_low:
        expansions.append("IO investigating officer")
    # 15-6 shorthand expansion
    if "15-6" in s_low and "ar" not in s_low:
        expansions.append("AR 15-6 administrative investigation")
    # Appointing authority expansions
    if "appoint" in s_low or "appointing authority" in s_low:
        expansions.append("appointing authority appointing official may appoint")
    # Boards/investigations cross terms
    if "board" in s_low or "investigation" in s_low:
        expansions.append("administrative investigations boards of officers")

    if expansions:
        return s + "\n\nQuery expansion:\n" + "\n".join(f"- {e}" for e in expansions)
    return s


# -------------------------
# JSON loading
# -------------------------

def load_chunks(json_path: str) -> List[Dict[str, Any]]:
    """
    Accepts either:
      A) Flat list of chunks (your combined JSON likely)
      B) Object with "chunks" field (per-reg file)
    Each chunk should include: regulation (optional), paragraph, subparagraph, text, heading_path (optional),
    is_aggregated (optional), source_subparagraphs (optional), chapter (optional).
    """
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
    """
    Lookup by (reg_display, paragraph, subparagraph_str).
    """
    lookup: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for ch in chunks:
        reg = _display_reg((ch.get("regulation") or ch.get("reg") or "").strip())
        para = (ch.get("paragraph") or ch.get("section") or "").strip()
        sub = (ch.get("subparagraph") or "").strip()
        if not (reg and para and ch.get("text")):
            continue
        lookup[(reg, para, sub)] = ch
    return lookup

def iter_documents(chunks: List[Dict[str, Any]]) -> List[Document]:
    """
    Build Documents for indexing. We index both leaf and context nodes but tag them in metadata.
    IMPORTANT: include legal identifiers in the indexed text to improve matching.
    """
    docs: List[Document] = []
    for ch in chunks:
        reg = _display_reg((ch.get("regulation") or ch.get("reg") or "").strip())
        para = (ch.get("paragraph") or ch.get("section") or "").strip()
        sub = (ch.get("subparagraph") or "").strip()
        text = _normalize_ws(ch.get("text") or "")
        if not (reg and para and text):
            continue

        heading_path = (ch.get("heading_path") or "").strip()
        is_agg = _is_aggregated_chunk(ch)

        para_id = _format_citation(reg, para, sub if sub else None)

        # Index text: include header + heading_path + body
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
                    "node_kind": "context" if is_agg else "leaf",
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
    """
    Deterministically expand context hits to leaf chunks.
    Returns a list of leaf chunk dicts.
    """
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
            return
        if sub.endswith("(full)") and _has_sibling_sub(reg, para, sub):
            return
        if re.fullmatch(r"[a-z]{1,2}", sub) and _has_child_sub(reg, para, sub):
            return
        key = (reg, para, sub)
        ch = chunks_lookup.get(key)
        if not ch:
            return
        # Skip aggregates: only leaf authority here
        if _is_aggregated_chunk(ch):
            return
        leaf_chunks[key] = ch

    def add_paragraph_siblings(reg: str, para: str):
        """
        Conservative sibling rule-set:
        - For eligibility/appointments, include a/b/e and sometimes c (special case).
        - For exceptions, include any subparas containing "except", "unless", "exigenc".
        - For definitions, include subparas that contain "means" / "definition" within the paragraph.
        """
        # Collect all subs for this paragraph from lookup
        subs = [sub for (r, p, sub) in chunks_lookup.keys() if r == reg and p == para and sub]
        # Cap to avoid runaway paragraphs
        subs = subs[:MAX_LEAF_PER_PARAGRAPH]

        if qtype == "eligibility":
            # High-value common pattern: a (general qualities), b (who may be appointed), e (assistant IO),
            # c (special stricter cases)
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

        # general: include only immediate base subparas + enumerations if present
        # (keeps context tight)
        for sub in subs:
            if re.fullmatch(r"[a-z]{1,2}(\(\d+\))?", sub):
                add_leaf(reg, para, sub)

    # Expand each context node
    for n in context_nodes:
        md = _node_md(n) or {}
        reg = (md.get("reg") or "").strip()
        para = (md.get("para") or "").strip()
        sub = (md.get("sub") or "").strip()
        if not (reg and para):
            continue

        # If it's an aggregate with provenance, pull those leaves
        src = md.get("source_subparagraphs") or []
        if src:
            for s in src:
                add_leaf(reg, para, s)

        # Also apply paragraph sibling rules when context node indicates we're in the right neighborhood
        # (especially helpful when only f(full) matched but b contains eligibility)
        add_paragraph_siblings(reg, para)

    # Safety cap
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
        }
    )


# -------------------------
# Main
# -------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True, help="Path to combined regulations JSON")
    ap.add_argument("--q", required=True, help="User query")
    ap.add_argument("--top", type=int, default=DEFAULT_OUTPUT_TOP, help="How many leaf extracts to output")
    ap.add_argument("--rebuild", action="store_true", help="Force rebuild index cache")
    ap.add_argument("--embed-model", default=EMBED_MODEL, help="Embedding model name")
    ap.add_argument("--rerank-model", default=RERANK_MODEL, help="Reranker model name")
    ap.add_argument("--no-rerank", action="store_true", help="Skip cross-encoder reranking (faster, lower quality)")
    ap.add_argument("--no-bm25", action="store_true", help="Disable BM25 hybrid retrieval (faster startup)")
    ap.add_argument("--timing", action="store_true", help="Print timing breakdown to stderr")
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

    # Configure embeddings + reranker
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

    # Load chunks and build lookup
    t0 = _t()
    chunks = load_chunks(str(json_path))
    lookup = build_lookup(chunks)
    _log("load+lookup chunks", t0)

    # Build / load vector index over ALL nodes (leaf + context)
    t0 = _t()
    docs = iter_documents(chunks)
    _log("build documents", t0)

    cache_root = Path(INDEX_CACHE_DIR)
    cache_root.mkdir(parents=True, exist_ok=True)

    cache_sig_src = "|".join([
        str(json_path.stat().st_mtime_ns),
        args.embed_model,
        "no_split_atomic_docs",
    ])
    cache_sig = hashlib.md5(cache_sig_src.encode("utf-8")).hexdigest()[:12]
    cache_dir = cache_root / f"{json_path.stem}_{cache_sig}"

    t0 = _t()
    if cache_dir.exists() and not args.rebuild:
        storage_context = StorageContext.from_defaults(persist_dir=str(cache_dir))
        index = load_index_from_storage(storage_context)
    else:
        index = VectorStoreIndex.from_documents(docs)
        index.storage_context.persist(persist_dir=str(cache_dir))
    _log("load/build vector index", t0)

    # Hybrid retrieval: dense + BM25
    t0 = _t()
    retriever_vec = index.as_retriever(similarity_top_k=VEC_TOP_K)
    bm25 = None
    if not args.no_bm25:
        try:
            from llama_index.core.retrievers import BM25Retriever
            bm25 = BM25Retriever.from_defaults(docstore=index.docstore, similarity_top_k=BM25_TOP_K)
        except Exception:
            bm25 = None
    _log("init retrievers", t0)

    q_aug = _augment_query(args.q)

    t0 = _t()
    nodes_vec = retriever_vec.retrieve(q_aug)
    nodes_bm25 = bm25.retrieve(q_aug) if bm25 else []
    nodes_fused = _rrf_fuse([nodes_vec, nodes_bm25]) if nodes_bm25 else nodes_vec
    nodes_fused = _unique_nodes(nodes_fused)
    _log("retrieve initial", t0)

    # Re-rank coarse candidates
    t0 = _t()
    if reranker_context:
        nodes_ctx = reranker_context.postprocess_nodes(nodes_fused, query_str=q_aug)
        nodes_ctx = _unique_nodes(nodes_ctx)
    else:
        nodes_ctx = nodes_fused
    _log("rerank context", t0)

    # Select context nodes (aggregates) + a few strong leaf nodes as anchors
    context_nodes = []
    for n in nodes_ctx:
        md = _node_md(n) or {}
        if md.get("node_kind") == "context" or md.get("is_aggregated"):
            context_nodes.append(n)

    # If no explicit context nodes hit, fall back to top leaf anchors
    if not context_nodes:
        context_nodes = nodes_ctx[: min(8, len(nodes_ctx))]

    # Deterministic expansion to leaf pool
    t0 = _t()
    leaf_pool_chunks = expand_from_context_hits(context_nodes, lookup, args.q)
    _log("expand leaf pool", t0)

    # If expansion produced too little, fall back to top leaf hits from ctx reranked list
    if len(leaf_pool_chunks) < 8:
        for n in nodes_ctx:
            md = _node_md(n) or {}
            if md.get("node_kind") == "leaf" and not md.get("is_aggregated"):
                # map to lookup chunk if possible
                reg, para, sub = md.get("reg",""), md.get("para",""), md.get("sub","")
                ch = lookup.get((reg, para, sub))
                if ch and not _is_aggregated_chunk(ch):
                    leaf_pool_chunks.append(ch)
            if len(leaf_pool_chunks) >= 30:
                break

    # Build a temporary index over leaf pool (fast; small) to re-rank/select best leaves
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

    # Output top leaf extracts
    out_top = max(1, args.top)
    results = []
    for n in leaf_nodes[:out_top]:
        md = _node_md(n) or {}
        node_obj = getattr(n, "node", n)
        txt = node_obj.get_content() if hasattr(node_obj, "get_content") else getattr(node_obj, "text", "")
        results.append({
            "para_id": md.get("para_id") or _format_citation(md.get("reg",""), md.get("para",""), md.get("sub") or None),
            "regulation": md.get("reg",""),
            "paragraph": md.get("para",""),
            "subparagraph": md.get("sub","") or None,
            "heading_path": md.get("heading_path",""),
            "text": _normalize_ws(txt),
        })

    print(json.dumps({"query": args.q, "retrieved_leaf_extracts": results}, indent=2))


if __name__ == "__main__":
    main()
