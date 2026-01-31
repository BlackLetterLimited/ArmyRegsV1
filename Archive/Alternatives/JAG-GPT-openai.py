import os
import sys
import json
import re
import hashlib
from pathlib import Path

from openai import OpenAI

from llama_index.core import (
    VectorStoreIndex,
    Settings,
    Document,
    StorageContext,
    load_index_from_storage,
)
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.prompts import PromptTemplate
from llama_index.embeddings.openai import OpenAIEmbedding

# Reranker import (optional, currently not used)
from llama_index.core.postprocessor import SentenceTransformerRerank as SbertRerank


# Config
OPENAI_MODEL = "gpt-4.1"
OPENAI_EMB_MODEL = "text-embedding-3-large"

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
MAX_CONTEXT_NODES = 12


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
        print("Usage: python JAG-GPT-openai.py /path/to/AR_by_id.json")
        sys.exit(1)
    json_path = sys.argv[1]

    if not os.getenv("OPENAI_API_KEY"):
        print("Missing OPENAI_API_KEY. Set it in your environment before running.")
        sys.exit(1)

    client = OpenAI()

    Settings.embed_model = OpenAIEmbedding(model=OPENAI_EMB_MODEL)
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
            OPENAI_EMB_MODEL,
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
- Treat medical, religious, or other carve-outs as exceptions, not baseline permission.
- Select the most relevant controlling paragraph(s). If multiple provisions are directly applicable, include all (up to 5).
- If the question is ambiguous (e.g., "What are the exceptions?" without a topic), ask a clarification question and do not cite.
- Use short direct quotes when possible. If the excerpts do not contain the needed rule, say "Not found in excerpts" and ask a clarification question.

Output format (mandatory):

1. Quick answer (1-3 sentences or bullet list if multiple provisions apply)
   - State the general rule(s).
   - If multiple provisions are directly applicable, list each with its citation (up to 5).
   - If applicable, note that limited exceptions exist.
   - Cite the controlling paragraph(s).

2. Explanation (short, focused)
   - Quote or closely paraphrase the relevant regulatory language.
   - Explain how the text supports the quick answer.
   - Identify exceptions only to the extent necessary.
   - Do not introduce ambiguity unless the text genuinely conflicts.

Rules:
- Do not infer beyond the text.
- Silence does not imply permission.
- Do not describe your reasoning process.
- Do not cite paragraphs you do not quote or explain.
- If you ask a clarification question, do not include citations.
- If a user asks "exceptions" without specifying a policy/topic, request clarification.
- If the answer is not explicitly supported by the excerpts, say "Not found in excerpts" and ask a clarification question.

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
        nodes = _rrf_fuse([nodes_vec, nodes_bm25]) if nodes_bm25 else nodes_vec

        if USE_RERANKER:
            nodes = _rerank_nodes(nodes, q_aug)

        reg_hints = _extract_reg_hints(q_aug)
        if reg_hints:
            hinted = []
            for n in nodes:
                md = _node_md(n) or {}
                reg = (md.get("reg") or "").upper().replace(" ", "")
                if reg and reg in reg_hints:
                    hinted.append(n)
            if hinted:
                rest = [n for n in nodes if n not in hinted]
                nodes = hinted + rest

        para_hints = _extract_para_hints(q_aug)
        if para_hints:
            hinted = [n for n in nodes if (_node_md(n) or {}).get("para") in para_hints]
            if hinted:
                rest = [n for n in nodes if n not in hinted]
                nodes = hinted + rest

        nodes = _unique_nodes(nodes)
        nodes = nodes[:MAX_CONTEXT_NODES]

        matches = []
        for n in nodes:
            md = _node_md(n) or {}
            regulation = (md.get("reg") or "").strip()
            paragraph = (md.get("para") or "").strip()
            sub_str = (md.get("sub") or "").strip()
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
            QUESTION=q,
            MATCHED_RULES=matches_json,
        )

        response = client.responses.create(
            model=OPENAI_MODEL,
            input=prompt,
        )
        return response.output_text, nodes

    print("Ready. Ask questions (Ctrl+C to exit).")
    history = []
    while True:
        try:
            q = input("> ").strip()
            if not q:
                continue

            answer_text, nodes = ask(q, history)
            history.append(q)

            source_ids = []
            for n in nodes:
                pid = (_node_md(n) or {}).get("para_id")
                if pid and pid not in source_ids:
                    source_ids.append(pid)

            text = answer_text.strip()

            if DEBUG and source_ids:
                text += "\n\nDebug:"
                text += "\n- Retrieved (top): " + "; ".join(source_ids[:MAX_SOURCES])
                text += f"\n- Retrieved count: {len(source_ids)}"

            print(text)
        except KeyboardInterrupt:
            print("\nGoodbye.")
            break


if __name__ == "__main__":
    main()
