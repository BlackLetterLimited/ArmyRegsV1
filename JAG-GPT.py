import sys
import json
import re
import hashlib
from pathlib import Path

from llama_index.core import (
    VectorStoreIndex,
    Settings,
    Document,
    StorageContext,
    load_index_from_storage,
)
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.prompts import PromptTemplate
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

# Reranker import (optional, currently not used)
from llama_index.core.postprocessor import SentenceTransformerRerank as SbertRerank


# Config
BASE_URL = "http://localhost:11434"
LLM_NAME = "llama3:8b"  
HF_EMB_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # small, fast CPU embedding

CHUNK_SIZE = 600
CHUNK_OVERLAP = 80
TOP_K = 60
RERANK_TOP_N = 15
USE_RERANKER = True
USE_HYBRID_RETRIEVAL = True
BM25_TOP_K = 20
INDEX_CACHE_DIR = ".index_cache"
DEBUG = True
MAX_SOURCES = 8
MAX_CONTEXT_QUESTIONS = 10


def _display_reg(reg: str) -> str:
    reg = (reg or "").strip()
    if not reg:
        return reg
    if reg.lower().startswith("ar "):
        return reg
    return f"AR {reg}"


def _build_doc_text(reg: str, para: str, sub: str, text: str) -> str:
    header = f"{_display_reg(reg)} {para}" + (f" {sub}" if sub else "")
    return f"{header}\n{text}"

def _format_citation(reg: str, para: str, sub: str) -> str:
    reg_disp = _display_reg(reg)
    if not para:
        return reg_disp
    if sub:
        s = sub
        # Insert a dot before the first parenthetical if missing (e.g., "a(1)" -> "a.(1)").
        if "(" in s and ".(" not in s:
            idx = s.find("(")
            if idx > 0 and s[idx - 1].isalnum():
                s = s[:idx] + "." + s[idx:]
        # Keep paragraph and subparagraph together with no spaces.
        return f"{reg_disp} para {para}.{s}"
    return f"{reg_disp} para {para}"


def load_docs_from_json(json_path: str):
    """Load JSON in either format:
    1) Flat list:
       [{"regulation":"AR 670-1","paragraph":"1-1","subparagraph":null,"text":"..."}]
    2) Chunked object:
       {"reg_number":"600-20","reg_title":"...","source":{...},"chunks":[...]}
    """
    items = json.loads(Path(json_path).read_text(encoding="utf-8"))
    docs = []

    if isinstance(items, dict) and "chunks" in items:
        reg = (items.get("reg_number") or items.get("regulation") or "").strip()
        reg_display = _display_reg(reg)
        for ch in items.get("chunks", []):
            para = (ch.get("paragraph") or ch.get("section") or "").strip()
            sub_raw = ch.get("subparagraph")
            sub = sub_raw.strip() if isinstance(sub_raw, str) else ""
            text = (ch.get("text") or "").strip()
            heading_path = (ch.get("heading_path") or "").strip()
            if not (reg_display and para and text):
                continue
            pid = _format_citation(reg_display, para, sub)
            embed_text = f"{heading_path}\n{text}".strip() if heading_path else text
            docs.append(
                Document(
                    # Use heading_path to improve retrieval; raw text lives in the document body.
                    text=embed_text,
                    metadata={
                        "reg": reg_display,
                        "para": para,
                        "sub": sub,
                        "para_id": pid,
                        "heading_path": heading_path,
                    },
                )
            )
        return docs

    # Fallback: legacy flat list
    for it in items:
        reg = (it.get("regulation") or "").strip()
        reg_display = _display_reg(reg)
        para = (it.get("paragraph") or "").strip()
        sub_raw = it.get("subparagraph")
        sub = sub_raw.strip() if isinstance(sub_raw, str) else ""
        text = (it.get("text") or "").strip()
        if not (reg_display and para and text):
            continue
        pid = _format_citation(reg_display, para, sub)
        docs.append(
            Document(
                text=text,
                metadata={
                    "reg": reg_display,
                    "para": para,
                    "sub": sub,
                    "para_id": pid,
                },
            )
        )
    return docs


def _list_regs_in_json(json_path: str) -> list[str]:
    items = json.loads(Path(json_path).read_text(encoding="utf-8"))
    regs = set()
    if isinstance(items, dict) and "chunks" in items:
        reg = (items.get("reg_number") or items.get("regulation") or "").strip()
        if reg:
            regs.add(_display_reg(reg))
    else:
        for it in items:
            reg = (it.get("regulation") or "").strip()
            if reg:
                regs.add(_display_reg(reg))
    return sorted(regs)


def format_node(n):
    """Helper for human-readable source lines."""
    md = _node_md(n) or {}
    reg = md.get("reg", "")
    para = md.get("para", "")
    sub_val = md.get("sub", "")
    sub = f" {sub_val}" if sub_val else ""
    header = f"[SOURCE {_display_reg(reg)} para {para}{sub}]\n"
    node_obj = getattr(n, "node", n)
    return header + node_obj.get_content()

def _extract_para_hints(q: str):
    return set(re.findall(r"\b\d+-\d+\b", q))

def _extract_reg_hints(q: str):
    # Prefer explicit AR references to avoid confusing paragraph numbers.
    ar_hits = re.findall(r"\bAR\s*([0-9]{1,4}-[0-9]{1,4})\b", q, flags=re.IGNORECASE)
    reg_hits = re.findall(r"\bregulation\s+([0-9]{1,4}-[0-9]{1,4})\b", q, flags=re.IGNORECASE)
    return set(h.upper().replace(" ", "") for h in ar_hits + reg_hits)

def _augment_question(q: str, history: list[str]) -> str:
    if not history:
        return q
    q_strip = q.strip().lower()
    short = len(q_strip.split()) <= 6
    followup_markers = (
        "what are the exceptions",
        "what are the exceptions?",
        "what are the exceptions to",
        "exceptions",
        "what about exceptions",
        "any exceptions",
        "what about that",
        "what about this",
        "what about it",
        "clarify",
    )
    if short or any(m in q_strip for m in followup_markers):
        prior = "\n".join(f"- {h}" for h in history[-MAX_CONTEXT_QUESTIONS:])
        return f"Prior questions in this session:\n{prior}\nQuestion: {q}"
    return q

def _node_md(n):
    md = getattr(n, "metadata", None)
    if md is not None:
        return md
    node = getattr(n, "node", None)
    return getattr(node, "metadata", None) if node is not None else {}


def _node_key(n):
    md = _node_md(n) or {}
    return (md.get("reg"), md.get("para"), md.get("sub"))


def _unique_nodes(nodes):
    seen = set()
    unique = []
    for n in nodes:
        key = _node_key(n)
        if key in seen:
            continue
        seen.add(key)
        unique.append(n)
    return unique

def _rrf_fuse(lists, k: int = 60):
    scores = {}
    nodes_by_key = {}
    for lst in lists:
        for rank, n in enumerate(lst, start=1):
            key = _node_key(n)
            if key not in nodes_by_key:
                nodes_by_key[key] = n
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
    fused = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [nodes_by_key[k] for k, _ in fused]


def main():
    if len(sys.argv) < 2:
        print("Usage: python rag_ollama_ar_json.py /path/to/AR_by_id.json")
        sys.exit(1)
    json_path = sys.argv[1]

    # LLM via Ollama; Embeddings via HuggingFace (avoids Ollama embedding endpoint)
    Settings.llm = Ollama(
        model=LLM_NAME,
        base_url=BASE_URL,
        request_timeout=120,
        temperature=0.1,
    )
    Settings.embed_model = HuggingFaceEmbedding(model_name=HF_EMB_MODEL)
    Settings.node_parser = SentenceSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )

    json_path_obj = Path(json_path)
    cache_root = Path(INDEX_CACHE_DIR)
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_sig_src = "|".join(
        [
            str(json_path_obj.stat().st_mtime_ns),
            str(CHUNK_SIZE),
            str(CHUNK_OVERLAP),
            HF_EMB_MODEL,
        ]
    )
    cache_sig = hashlib.md5(cache_sig_src.encode("utf-8")).hexdigest()[:10]
    cache_dir = cache_root / f"{json_path_obj.stem}_{cache_sig}"

    if cache_dir.exists():
        storage_context = StorageContext.from_defaults(persist_dir=str(cache_dir))
        index = load_index_from_storage(storage_context)
    else:
        docs = load_docs_from_json(json_path)
        if not docs:
            print("No documents loaded from JSON.")
            sys.exit(1)
        index = VectorStoreIndex.from_documents(docs)
        index.storage_context.persist(persist_dir=str(cache_dir))

    regs_list = _list_regs_in_json(json_path)
    if regs_list:
        print("Regulations in JSON:")
        for r in regs_list:
            print(f"- {r}")
        print()

    # Prompt explicitly matches your JSON hierarchy: regulation / paragraph / subparagraph / text
    prompt_tmpl = PromptTemplate(
"""
You are an Army legal reference assistant.

Your task is to provide a concise legal answer followed by a short,
citation-supported explanation based solely on the provided
Regulation Excerpts JSON.

Your ONLY binding authority is the Regulation Excerpts JSON.

Internal requirements (do not output):
- Identify the general rule established by the regulation.
- Determine whether the rule is prohibitory, permissive, or conditional.
- Select the most relevant controlling paragraph(s). If multiple provisions are directly applicable, include all.
- If the question is ambiguous (e.g., "What are the exceptions?" without a topic), ask a clarification question.
- You must include at least one short direct quote from the regulation in the Explanation. If no quote is possible, say so and ask for clarification.
- If there isn't enough information to answer the question, ask for clarification rather than guessing.

Output format (mandatory):

1. Bottom Line (1-3 sentences or bullet list if multiple provisions apply)
   - State the general rule(s).
   - If multiple provisions are directly applicable, list each with its citation (up to 5).
   - If applicable, note that limited exceptions exist but don't provide details here unless it would answer the question or avoid misleading the user.
   - Cite the controlling paragraph(s).

2. Explanation (short, focused)
   - Quote the relevant regulatory language verbatim, in quotation marks. Immediately follow that with a sentence applying the language to the user's question.
   - Identify exceptions only to the extent necessary.
   - Do not introduce ambiguity unless the text genuinely conflicts.

Rules:
- Do not cite paragraphs you do not quote or explain.
- If you ask a clarification question, you do not have to include citations.
- Ask for clarification if the question is too broad or ambiguous.
- You can reference external common knowledge only to provide context; do not use it to answer the question if the Regulation Excerpts JSON provides sufficient information.
- Use the exact citation format specified below.
- Don't overuse legalese; prefer clear and simple language.
- Take time to analyze the Regulation Excerpts JSON before answering.
- If the Regulation Excerpts JSON does not contain relevant information, state that you cannot answer based on the provided excerpts. DO NOT cite random provisions or explain why there is not enough information.
- Broad questions rule: If the question asks for a list/types/grounds/bases/reasons or otherwise broad coverage, and the excerpts include multiple distinct bases/chapters, you MUST include multiple distinct bases (up to 8) rather than selecting only one. If the excerpts look incomplete for a full list, explicitly say so and ask the user to narrow scope (e.g., specify chapter/basis/timeframe).


Citation format:
AR [number] para [paragraph][.subparagraph].
Do not use commas. No gaps between paragraph and subparagraph.
Example: AR 600-20 para 1-2.a.(1)(A).

You must now answer the following question:

Question: {QUESTION}

Regulation Excerpts JSON:
{MATCHED_RULES}
"""
    )

    retriever = index.as_retriever(similarity_top_k=TOP_K)
    bm25_retriever = None
    if USE_HYBRID_RETRIEVAL:
        try:
            from llama_index.core.retrievers import BM25Retriever
            bm25_retriever = BM25Retriever.from_defaults(
                docstore=index.docstore, similarity_top_k=BM25_TOP_K
            )
        except Exception:
            bm25_retriever = None
    reranker = SbertRerank(model="cross-encoder/ms-marco-MiniLM-L-6-v2", top_n=RERANK_TOP_N)

    def _rerank_nodes(nodes, q: str):
        # Handle llama-index version differences in reranker API.
        try:
            return reranker.postprocess_nodes(nodes, query_str=q)
        except TypeError:
            try:
                return reranker.postprocess_nodes(nodes, query=q)
            except TypeError:
                try:
                    from llama_index.core.schema import QueryBundle
                except Exception:
                    from llama_index.core import QueryBundle
                return reranker.postprocess_nodes(nodes, query_bundle=QueryBundle(q))

    def ask(q: str, history: list[str]):
        q_aug = _augment_question(q, history)
        nodes_vec = retriever.retrieve(q_aug)
        nodes_bm25 = bm25_retriever.retrieve(q_aug) if bm25_retriever else []
        nodes_vec_keys = {_node_key(n) for n in nodes_vec}
        nodes_bm25_keys = {_node_key(n) for n in nodes_bm25}
        nodes = _rrf_fuse([nodes_vec, nodes_bm25]) if nodes_bm25 else nodes_vec

        if USE_RERANKER:
            nodes = _rerank_nodes(nodes, q_aug)

        reg_hints = _extract_reg_hints(q_aug)
        reg_hint_keys = set()
        if reg_hints:
            hinted = []
            for n in nodes:
                md = _node_md(n) or {}
                reg = (md.get("reg") or "").upper().replace(" ", "")
                if reg and reg in reg_hints:
                    hinted.append(n)
                    reg_hint_keys.add(_node_key(n))
            if hinted:
                rest = [n for n in nodes if n not in hinted]
                nodes = hinted + rest

        para_hints = _extract_para_hints(q_aug)
        para_hint_keys = set()
        if para_hints:
            hinted = [n for n in nodes if (_node_md(n) or {}).get("para") in para_hints]
            para_hint_keys = {_node_key(n) for n in hinted}
            if hinted:
                rest = [n for n in nodes if n not in hinted]
                nodes = hinted + rest

        nodes = _unique_nodes(nodes)

        # Build JSON structure expected by the prompt:
        # {
        #   "matches": [
        #     {
        #       "regulation": "...",
        #       "paragraph": "...",
        #       "subparagraph": null | "...",
        #       "text": "..."
        #     },
        #     ...
        #   ]
        # }
        matches = []
        for n in nodes:
            md = _node_md(n) or {}
            regulation = (md.get("reg") or "").strip()
            paragraph = (md.get("para") or "").strip()
            sub_str = (md.get("sub") or "").strip()
            # Represent absent subparagraph as null in JSON, not empty string
            subparagraph = sub_str if sub_str else None
            node_obj = getattr(n, "node", n)
            content = (node_obj.get_content() or "").strip()
            heading_path = (md.get("heading_path") or "").strip()
            header = _build_doc_text(regulation, paragraph, sub_str, "").strip()
            text = content
            if heading_path and text.startswith(heading_path):
                text = text[len(heading_path):].lstrip("\n").strip()
            if content.startswith(header):
                text = content[len(header):].lstrip("\n").strip()

            matches.append(
                {
                    "regulation": regulation,
                    "paragraph": paragraph,
                    "subparagraph": subparagraph,
                    "text": text,
                }
            )

        matches_json = json.dumps({"matches": matches}, indent=2)

        prompt = prompt_tmpl.format(
            QUESTION=q_aug,
            MATCHED_RULES=matches_json,
        )

        llm = Settings.llm
        resp = llm.complete(prompt)
        debug_sources = []
        for n in nodes:
            md = _node_md(n) or {}
            pid = md.get("para_id") or _format_citation(
                md.get("reg") or "", md.get("para") or "", md.get("sub") or ""
            )
            key = _node_key(n)
            reasons = []
            if key in nodes_vec_keys:
                reasons.append("vector similarity")
            if key in nodes_bm25_keys:
                reasons.append("BM25 lexical")
            if key in reg_hint_keys:
                reasons.append("matches AR hint")
            if key in para_hint_keys:
                reasons.append("matches paragraph hint")
            if USE_RERANKER:
                reasons.append("reranked cross-encoder")
            if not reasons:
                reasons.append("top-k retrieval")
            debug_sources.append({"para_id": pid, "reasons": reasons})
        return str(resp), nodes, debug_sources

    print("Ready. Ask questions (Ctrl+C to exit).")
    history = []
    while True:
        try:
            q = input("> ").strip()
            if not q:
                continue

            answer_text, nodes, debug_sources = ask(q, history)
            history.append(q)

            # Collect paragraph IDs from retrieved nodes
            source_ids = []
            for n in nodes:
                pid = (_node_md(n) or {}).get("para_id")
                if pid and pid not in source_ids:
                    source_ids.append(pid)

            text = answer_text.strip()
            if ("[" not in text or "]" not in text) and source_ids:
                text += "\n\nSources: " + "; ".join(source_ids[:MAX_SOURCES])

            if DEBUG and source_ids:
                text += "\n\nDebug:"
                text += "\n- Retrieved (top): " + "; ".join(source_ids[:MAX_SOURCES])
                text += f"\n- Retrieved count: {len(source_ids)}"
                text += "\n- Reasons:"
                for info in debug_sources[:MAX_SOURCES]:
                    pid = info.get("para_id")
                    reasons = ", ".join(info.get("reasons") or [])
                    if pid and reasons:
                        text += f"\n  - {pid}: {reasons}"

            print(text)
        except KeyboardInterrupt:
            print("\nGoodbye.")
            break


if __name__ == "__main__":
    main()
