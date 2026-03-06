import sys
import json
import re
import hashlib
import os
from datetime import datetime, timezone
from typing import Optional, Dict
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
from llama_index.core.llms.custom import CustomLLM
from llama_index.core.base.llms.types import CompletionResponse, CompletionResponseGen, LLMMetadata
from llama_index.core.llms.callbacks import llm_completion_callback
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from ollama import Client
client = Client(
    host="https://ollama.com",
    headers={'Authorization': 'Bearer ' + os.environ.get('OLLAMA_API_KEY')}
)
# Reranker import (optional, currently not used)
from llama_index.core.postprocessor import SentenceTransformerRerank as SbertRerank


# Config
BASE_URL = "https://ollama.com"
LLM_NAME = "gpt-oss:120b"
HF_EMB_MODEL =  "BAAI/bge-base-en-v1.5" # higher quality embeddings
HF_EMB_FALLBACK_MODELS = [
    "BAAI/bge-base-en-v1.5",
    "BAAI/bge-small-en-v1.5",
    "sentence-transformers/all-MiniLM-L6-v2",
    "sentence-transformers/all-mpnet-base-v2"
]

CHUNK_SIZE = 4000
CHUNK_OVERLAP = 100
# Retrieve a wider candidate pool, then rerank and cut down.
TOP_K = 120
RERANK_TOP_N = 60
FINAL_TOP_K = 18
USE_RERANKER = True
USE_HYBRID_RETRIEVAL = True
BM25_TOP_K = 140
# Dual retrieval: use aggregated/context nodes to expand into precise leaf citations.
USE_DUAL_RETRIEVAL = True
MAX_CONTEXT_NODES = 7
MAX_LEAF_ANCHORS = 16
INDEX_CACHE_DIR = ".index_cache"
DEBUG = False
MAX_SOURCES = 8
MAX_CONTEXT_QUESTIONS = 10
DEFAULT_JSON_PATH = "regs_combined.json"
QA_LOG_PATH = "./Logs/14Feb26.jsonl"
EMBEDDING_TEST_PATH = "embedding_test.tsv"
BENCHMARK_LOG_DIR = "./Logs"
# Set benchmark-on-start behavior here.
# Requested toggle: "Test Embedinngs True/False"
TEST_EMBEDINNGS = False


def _extract_ollama_content(resp) -> str:
    if isinstance(resp, dict):
        return (resp.get("message") or {}).get("content") or ""
    message = getattr(resp, "message", None)
    if message is not None:
        content = getattr(message, "content", None)
        if content is not None:
            return content
    return getattr(resp, "response", "") or ""


def _append_qa_log(
    question: str,
    answer: str,
    source_ids: list[str],
    prompt: str = "",
    log_path: str = QA_LOG_PATH,
) -> None:
    """Append one Q/A interaction as a JSON line for future review."""
    record = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "question": question,
        "answer": answer,
        "source_ids": source_ids,
        "prompt": prompt,
    }
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as exc:
        print(f"Warning: failed to write Q/A log to {log_path}: {exc}")


def _parse_embedding_test(path: str) -> list[tuple[str, str]]:
    """
    Parse embedding test file lines into (question, expected_citation_expr).
    Accepts either tab-delimited lines or lines separated by 2+ spaces.
    """
    pairs: list[tuple[str, str]] = []
    file_path = Path(path)
    if not file_path.exists():
        return pairs

    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if "\t" in raw_line:
            parts = raw_line.split("\t", 1)
        else:
            parts = re.split(r"\s{2,}", raw_line, maxsplit=1)

        if len(parts) != 2:
            continue
        question = parts[0].strip()
        expected = parts[1].strip()
        if question and expected:
            pairs.append((question, expected))
    return pairs


def _new_benchmark_log_path(log_dir: str) -> str:
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return str(Path(log_dir) / f"embedding_benchmark_{ts}.jsonl")


def _append_benchmark_log(
    log_path: str,
    question: str,
    expected_citations: str,
    answer: str,
    source_ids: list[str],
    prompt: str = "",
) -> None:
    record = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "question": question,
        "expected_citations": expected_citations,
        "answer": answer,
        "source_ids": source_ids,
        "prompt": prompt,
    }
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as exc:
        print(f"Warning: failed to write benchmark log to {log_path}: {exc}")


def _normalize_citation(citation: str) -> str:
    return " ".join((citation or "").strip().upper().split())


def _parse_expected_citation_groups(expected: str) -> list[set[str]]:
    groups: list[set[str]] = []
    for group_str in (expected or "").split("||"):
        group = {
            _normalize_citation(citation)
            for citation in group_str.split("&&")
            if citation.strip()
        }
        if group:
            groups.append(group)
    return groups


def _citation_para_base(citation: str) -> str:
    """
    Convert citation to paragraph-base form.
    Example: AR 1-100 para 3-13.c.(1) -> AR 1-100 PARA 3-13
    """
    c = _normalize_citation(citation)
    m = re.match(r"^(AR\s+\S+\s+PARA\s+)(\d+-\d+)", c)
    if m:
        return f"{m.group(1)}{m.group(2)}"
    return c


def _strict_citation_match(expected: str, source_norm: set[str]) -> bool:
    """
    Strict match with one allowance:
    - If expected is first-level subparagraph (e.g., AR ... para 1-1.a),
      count deeper descendants (e.g., AR ... para 1-1.a.(1)) as a hit.
    """
    expected_norm = _normalize_citation(expected)
    if expected_norm in source_norm:
        return True

    # Detect first-level subparagraph form.
    # Example: AR 600-20 PARA 1-1.A
    m = re.match(r"^(AR\s+\S+\s+PARA\s+\d+-\d+\.[A-Z]{1,3})$", expected_norm)
    if not m:
        return False

    # Descendant examples:
    # AR 600-20 PARA 1-1.A.(1)
    # AR 600-20 PARA 1-1.A.(1)(A)
    descendant_prefix = f"{expected_norm}.("
    return any(src.startswith(descendant_prefix) for src in source_norm)


def _citations_match_expected(expected_expr: str, source_ids: list[str], paragraph_level: bool = False) -> bool:
    groups = _parse_expected_citation_groups(expected_expr)
    if not groups:
        return False
    source_norm = {_normalize_citation(s) for s in source_ids}
    if paragraph_level:
        source_para = {_citation_para_base(s) for s in source_norm}
    for group in groups:
        if paragraph_level:
            if all((need in source_norm) or (_citation_para_base(need) in source_para) for need in group):
                return True
        else:
            if all(_strict_citation_match(need, source_norm) for need in group):
                return True
    return False


class OllamaClientLLM(CustomLLM):
    def __init__(self, model: str, base_url: str, headers: Optional[Dict[str, str]] = None, options: Optional[Dict] = None):
        super().__init__()
        self._model = model
        self._base_url = base_url
        self._headers = headers or {}
        self._options = options or {}
        self._client = Client(host=self._base_url, headers=self._headers)

    @property
    def metadata(self) -> LLMMetadata:
        return LLMMetadata(model_name=self._model, is_chat_model=True)

    @llm_completion_callback()
    def complete(self, prompt: str, formatted: bool = False, **kwargs) -> CompletionResponse:
        resp = self._client.chat(
            self._model,
            messages=[{"role": "user", "content": prompt}],
            stream=False,
            options=self._options or None,
        )
        text = _extract_ollama_content(resp)
        return CompletionResponse(text=text, raw=resp)

    @llm_completion_callback()
    def stream_complete(self, prompt: str, formatted: bool = False, **kwargs) -> CompletionResponseGen:
        def gen():
            text_acc = ""
            for part in self._client.chat(
                self._model,
                messages=[{"role": "user", "content": prompt}],
                stream=True,
                options=self._options or None,
            ):
                delta = _extract_ollama_content(part)
                if not delta:
                    continue
                text_acc += delta
                yield CompletionResponse(text=text_acc, delta=delta, raw=part)

        return gen()


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


def _embed_text(reg: str, para: str, sub: str, heading_path: str, text: str) -> str:
    """Build embedding text with structured identifiers to improve retrieval."""
    reg_disp = _display_reg(reg)
    para = (para or "").strip()
    sub = (sub or "").strip()
    heading_path = (heading_path or "").strip()
    header = f"{reg_disp} para {para}" + (f".{sub}" if sub else "")
    parts = [p for p in (header, heading_path, text) if p]
    return "\n".join(parts).strip()


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
            is_aggregated = bool(ch.get("is_aggregated", False))
            if not (reg_display and para and text):
                continue
            pid = _format_citation(reg_display, para, sub)
            embed_text = _embed_text(reg_display, para, sub, heading_path, text)
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
                        "is_aggregated": is_aggregated,
                        "source_subparagraphs": ch.get("source_subparagraphs") or [],
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
        heading_path = (it.get("heading_path") or "").strip()
        is_aggregated = bool(it.get("is_aggregated", False))
        if not (reg_display and para and text):
            continue
        pid = _format_citation(reg_display, para, sub)
        embed_text = _embed_text(reg_display, para, sub, heading_path, text)
        docs.append(
            Document(
                text=embed_text,
                metadata={
                    "reg": reg_display,
                    "para": para,
                    "sub": sub,
                    "para_id": pid,
                    "heading_path": heading_path,
                    "is_aggregated": is_aggregated,
                    "source_subparagraphs": it.get("source_subparagraphs") or [],
                },
            )
        )
    return docs


def _doc_key(reg: str, para: str, sub: str) -> tuple[str, str, str]:
    return (_display_reg(reg), (para or "").strip(), (sub or "").strip())


def _entry_text(entry: dict) -> str:
    text = (entry.get("text") or "").strip()
    heading_path = (entry.get("heading_path") or "").strip()
    if heading_path and text.startswith(heading_path):
        text = text[len(heading_path):].lstrip("\n").strip()
    return text


def load_doc_map_from_json(json_path: str) -> dict[tuple[str, str, str], dict]:
    items = json.loads(Path(json_path).read_text(encoding="utf-8"))
    doc_map: dict[tuple[str, str, str], dict] = {}

    def _add_entry(reg: str, para: str, sub: str, entry: dict):
        key = _doc_key(reg, para, sub)
        doc_map[key] = {
            "reg": _display_reg(reg),
            "para": (para or "").strip(),
            "sub": (sub or "").strip(),
            "text": (entry.get("text") or "").strip(),
            "heading_path": (entry.get("heading_path") or "").strip(),
            "is_aggregated": bool(entry.get("is_aggregated", False)),
            "source_subparagraphs": entry.get("source_subparagraphs"),
        }

    if isinstance(items, dict) and "chunks" in items:
        reg = (items.get("reg_number") or items.get("regulation") or "").strip()
        for ch in items.get("chunks", []):
            if not isinstance(ch, dict):
                continue
            para = (ch.get("paragraph") or ch.get("section") or "").strip()
            sub_raw = ch.get("subparagraph")
            sub = sub_raw.strip() if isinstance(sub_raw, str) else ""
            text = (ch.get("text") or "").strip()
            if not (reg and para and text):
                continue
            _add_entry(reg, para, sub, ch)
        return doc_map

    # Fallback: flat list
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            reg = (it.get("regulation") or it.get("reg_number") or it.get("reg") or "").strip()
            para = (it.get("paragraph") or it.get("section") or "").strip()
            sub_raw = it.get("subparagraph")
            sub = sub_raw.strip() if isinstance(sub_raw, str) else ""
            text = (it.get("text") or "").strip()
            if not (reg and para and text):
                continue
            _add_entry(reg, para, sub, it)
    return doc_map


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
    # Heuristic: avoid history bleed if topic appears to change.
    def _tokens(s: str) -> set[str]:
        return set(re.findall(r"[a-z0-9]{3,}", s.lower()))
    def _topic_overlap(a: str, b: str) -> float:
        ta = _tokens(a)
        tb = _tokens(b)
        if not ta or not tb:
            return 0.0
        return len(ta & tb) / max(1, len(ta | tb))

    # Explicit reset phrases.
    if any(p in q_strip for p in ("new topic", "different topic", "unrelated", "switch topics", "change subject")):
        return q

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
        # Only use history if the new question overlaps with recent topics.
        recent = history[-MAX_CONTEXT_QUESTIONS:]
        overlap = max(_topic_overlap(q_strip, h) for h in recent) if recent else 0.0
        if overlap < 0.08:
            return q
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

def _node_text(n) -> str:
    node = getattr(n, "node", n)
    text = getattr(node, "text", None)
    if text is None:
        get_content = getattr(node, "get_content", None)
        if callable(get_content):
            try:
                text = get_content()
            except TypeError:
                try:
                    from llama_index.core.schema import MetadataMode
                    text = get_content(metadata_mode=MetadataMode.NONE)
                except Exception:
                    text = None
    if text is None:
        get_text = getattr(node, "get_text", None)
        if callable(get_text):
            try:
                text = get_text()
            except Exception:
                text = None
    if not isinstance(text, str):
        return ""

    md = _node_md(n) or {}
    heading_path = (md.get("heading_path") or "").strip()
    if heading_path and text.startswith(heading_path):
        text = text[len(heading_path):].lstrip("\n").strip()
    return text.strip()


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


def _init_embedding_model():
    """
    Try preferred embedding model first, then fall back to known public models.
    This avoids hard startup failures when a model id is invalid or private.
    """
    candidates = [HF_EMB_MODEL] + [m for m in HF_EMB_FALLBACK_MODELS if m != HF_EMB_MODEL]
    last_err = None
    for model_name in candidates:
        try:
            model = HuggingFaceEmbedding(model_name=model_name)
            if model_name != HF_EMB_MODEL:
                print(f"Embedding fallback in use: {model_name}")
            return model, model_name
        except Exception as exc:
            last_err = exc
            print(f"Embedding model unavailable: {model_name} ({exc})")
    raise RuntimeError(
        "Failed to initialize all embedding model candidates. "
        "Set HF_EMB_MODEL to a valid public model or authenticate with Hugging Face."
    ) from last_err


def main():
    if len(sys.argv) >= 2:
        json_path = sys.argv[1]
    else:
        json_path = DEFAULT_JSON_PATH

    # LLM and Embeddings via Ollama (supports cloud base_url + auth headers)
    ollama_headers = {}

    # api_key = os.environ.get("OLLAMA_API_KEY")
    api_key = "c869d68c0fee43fe897198eec5572d01.vaWOBA6UMfWlaNF0AXn78Qy8"
    if api_key:
        ollama_headers["Authorization"] = f"Bearer {api_key}"

    Settings.llm = OllamaClientLLM(
        model=LLM_NAME,
        base_url=BASE_URL,
        headers=ollama_headers if ollama_headers else None,
        options={"temperature": 0.1},
    )
    embed_model, embed_model_name = _init_embedding_model()
    Settings.embed_model = embed_model
    Settings.node_parser = SentenceSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )

    json_path_obj = Path(json_path)
    doc_map = load_doc_map_from_json(json_path)
    cache_root = Path(INDEX_CACHE_DIR)
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_sig_src = "|".join(
        [
            str(json_path_obj.stat().st_mtime_ns),
            str(CHUNK_SIZE),
            str(CHUNK_OVERLAP),
            embed_model_name,
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
You are an Army Judge Advocate.

You are going to be asked questions by Soldiers and Commanders which need answers supported by applicable Army Regulations.
Because these are legal answers, it is very important that your responses are all based in the verbatim text of the Regulations and you do not make anything up or assume answers you do not know for certain.

To assist you, a RAG retriever has searched through a database of Army Regulations and identified the most applicable provisions.
Because retrievers are imperfect, you will need to do your own assessment as to whether these provisions are relevant to the question presented.
If an excerpt is not relevant, disregard it.  If none of the excerpts are relevant, disregard them all and respond that you were unable to find an answer in the regulations. DO NOT GUESS OR MAKE ANYTHING UP!
As part of your analysis, determine whether the rule is prohibitory, permissive, or conditional.
If you need more information, ask the user follow-up questions to provide more context.
If any excerpt contains explicit prohibition language (‘not authorized’, ‘will keep’, ‘will not’), treat it as the baseline rule unless another excerpt explicitly overrides it.

Once you review the excerpts and determine the answer to the question is contained within them:
1) provide a summary answer that directly responds to the question.
2) give a more detailed answer to the question applying the regulations as a lawyer would: pointing out any vague or discretionary terms or other limiting principles which may impact interpretation.
3) State the general rule and provide a VERBATIM quote of the applicable regulation followed by a citation (in the format explained below). If multiple excerpts are relevant to answering the question, state them all, along with quotes and citations.
4) if the regulation excerpt references another regulation or paragraph, be sure to note that.


Rules:
- Do not cite paragraphs you do not quote or explain.
- If you ask a clarification question, you do not have to include citations.
- Ask for clarification if the question is too broad or ambiguous.
- You can reference external common knowledge only to provide context; do not use it to answer the question if the Regulation Excerpts provides sufficient information.
- Use the exact citation format specified below.
- Don't overuse legalese; prefer clear and simple language.
- Take time to analyze the Regulation Excerpts before answering.
- If the Regulation Excerpts do not contain relevant information, state that you cannot answer based on the provided excerpts. DO NOT cite random provisions or explain why there is not enough information.
- Broad questions rule: If the question asks for a list/types/grounds/bases/reasons or otherwise broad coverage, and the excerpts include multiple distinct bases/chapters, you MUST include multiple distinct bases (up to 8) rather than selecting only one. If the excerpts look incomplete for a full list, explicitly say so and ask the user to narrow scope (e.g., specify chapter/basis/timeframe).


Citation format:
AR [number] para [paragraph][.subparagraph].
Do not use commas. No gaps between paragraph and subparagraph.
Example: AR 600-20 para 1-2.a.(1)(A).

You must now answer the following question:

Question: {QUESTION}

Regulation Excerpts:
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

    def _expand_nodes(nodes, doc_map: dict) -> list[dict]:
        """Expand aggregated nodes into their child subparagraph entries for citations."""
        def _has_child_sub(reg: str, para: str, sub: str) -> bool:
            if not sub:
                return False
            reg_disp = _display_reg(reg)
            prefix = f"{sub}("
            for (r, p, s) in doc_map.keys():
                if r == reg_disp and p == para and s.startswith(prefix):
                    return True
            return False

        def _has_sibling_sub(reg: str, para: str, sub: str) -> bool:
            reg_disp = _display_reg(reg)
            base = sub.split("(", 1)[0] if "(" in sub else sub
            for (r, p, s) in doc_map.keys():
                if r != reg_disp or p != para or not s or s == sub:
                    continue
                if s == base or s.startswith(base + "("):
                    return True
            return False

        def _sub_sort_key(s: str):
            if "(" not in s:
                return (0, 0, s)
            m = re.search(r"\((\d+)\)", s)
            if m:
                return (1, int(m.group(1)), s)
            return (2, 0, s)

        expanded = []
        seen = set()
        for n in nodes:
            md = _node_md(n) or {}
            reg = (md.get("reg") or "").strip()
            para = (md.get("para") or "").strip()
            sub = (md.get("sub") or "").strip()
            is_agg = bool(md.get("is_aggregated", False))

            if is_agg:
                source_subs = []
                entry = doc_map.get(_doc_key(reg, para, sub))
                if entry and entry.get("source_subparagraphs"):
                    source_subs = list(entry.get("source_subparagraphs") or [])
                else:
                    letter = sub.split("(", 1)[0] if sub else ""
                    if letter:
                        for (r, p, s) in doc_map.keys():
                            if r == _display_reg(reg) and p == para and (
                                s == letter or s.startswith(f"{letter}(")
                            ):
                                source_subs.append(s)
                source_subs = sorted(set(source_subs), key=_sub_sort_key)
                added_any = False
                for s in source_subs:
                    key = _doc_key(reg, para, s)
                    entry = doc_map.get(key)
                    if not entry:
                        continue
                    if key in seen:
                        continue
                    seen.add(key)
                    expanded.append(entry)
                    added_any = True
                # If nothing expanded, fall back to the aggregated entry.
                if not added_any:
                    key = _doc_key(reg, para, sub)
                    if key not in seen:
                        seen.add(key)
                        expanded.append({
                            "reg": reg,
                            "para": para,
                            "sub": sub,
                            "text": _node_text(n),
                            "heading_path": "",
                            "is_aggregated": True,
                            "source_subparagraphs": source_subs or None,
                        })
                continue

            key = _doc_key(reg, para, sub)
            if key in seen:
                continue
            seen.add(key)
            entry = doc_map.get(key)
            if entry:
                expanded.append(entry)
            else:
                expanded.append({
                    "reg": reg,
                    "para": para,
                    "sub": sub,
                    "text": _node_text(n),
                    "heading_path": md.get("heading_path"),
                    "is_aggregated": False,
                    "source_subparagraphs": None,
                })

        # Filter duplicate/aggregate-style leaves:
        # - Drop "(full)" entries when sibling subparagraphs exist.
        # - Drop parent letter-only entries when numbered children exist.
        filtered = []
        for entry in expanded:
            reg = (entry.get("reg") or "").strip()
            para = (entry.get("para") or "").strip()
            sub = (entry.get("sub") or "").strip()
            if sub.endswith("(full)") and _has_sibling_sub(reg, para, sub):
                continue
            if re.fullmatch(r"[a-z]{1,2}", sub) and _has_child_sub(reg, para, sub):
                continue
            filtered.append(entry)
        return filtered

    def ask(q: str, history: list[str]):
        q_aug = _augment_question(q, history)
        nodes_vec = retriever.retrieve(q_aug)
        nodes_bm25 = bm25_retriever.retrieve(q_aug) if bm25_retriever else []
        nodes = _rrf_fuse([nodes_vec, nodes_bm25]) if nodes_bm25 else nodes_vec

        if USE_RERANKER:
            nodes = _rerank_nodes(nodes, q_aug)
            if FINAL_TOP_K and len(nodes) > FINAL_TOP_K:
                nodes = nodes[:FINAL_TOP_K]

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

        def _merge_entries(primary: list[dict], secondary: list[dict]) -> list[dict]:
            out = []
            seen = set()
            for entry in primary + secondary:
                key = _doc_key(entry.get("reg") or "", entry.get("para") or "", entry.get("sub") or "")
                if key in seen:
                    continue
                seen.add(key)
                out.append(entry)
            return out

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
        if USE_DUAL_RETRIEVAL:
            context_nodes = [
                n for n in nodes if (_node_md(n) or {}).get("is_aggregated")
            ]
            if not context_nodes:
                context_nodes = nodes[: min(MAX_CONTEXT_NODES, len(nodes))]
            expanded_entries = _expand_nodes(context_nodes, doc_map)

            leaf_anchors = [
                n for n in nodes if not (_node_md(n) or {}).get("is_aggregated")
            ][:MAX_LEAF_ANCHORS]
            if leaf_anchors:
                anchor_entries = _expand_nodes(leaf_anchors, doc_map)
                expanded_entries = _merge_entries(expanded_entries, anchor_entries)
        else:
            expanded_entries = _expand_nodes(nodes, doc_map)
        for entry in expanded_entries:
            regulation = (entry.get("reg") or "").strip()
            paragraph = (entry.get("para") or "").strip()
            sub_str = (entry.get("sub") or "").strip()
            subparagraph = sub_str if sub_str else None
            text = _entry_text(entry)
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
        for entry in expanded_entries:
            pid = _format_citation(
                entry.get("reg") or "", entry.get("para") or "", entry.get("sub") or ""
            )
            debug_sources.append({"para_id": pid, "text": _entry_text(entry)})
        return str(resp), nodes, debug_sources, prompt

    def run_startup_embedding_benchmark():
        if not TEST_EMBEDINNGS:
            print("Startup embedding benchmark disabled (TEST_EMBEDINNGS=False).\n")
            return

        test_pairs = _parse_embedding_test(EMBEDDING_TEST_PATH)
        if not test_pairs:
            print(f"No benchmark questions loaded from {EMBEDDING_TEST_PATH}. Skipping startup benchmark.")
            return

        benchmark_log_path = _new_benchmark_log_path(BENCHMARK_LOG_DIR)
        total = len(test_pairs)
        strict_hits = 0
        para_hits = 0
        error_count = 0
        retrieved_total = 0
        print(f"Running startup embedding benchmark: {total} questions")
        print(f"Benchmark log: {benchmark_log_path}")

        for i, (question, expected_expr) in enumerate(test_pairs, start=1):
            try:
                answer_text, _, debug_sources, used_prompt = ask(question, [])
                source_ids = []
                for info in debug_sources:
                    pid = info.get("para_id")
                    if pid and pid not in source_ids:
                        source_ids.append(pid)
                retrieved_total += len(source_ids)
                if _citations_match_expected(expected_expr, source_ids, paragraph_level=False):
                    strict_hits += 1
                if _citations_match_expected(expected_expr, source_ids, paragraph_level=True):
                    para_hits += 1
                _append_benchmark_log(
                    benchmark_log_path,
                    question=question,
                    expected_citations=expected_expr,
                    answer=answer_text.strip(),
                    source_ids=source_ids,
                    prompt=used_prompt,
                )
                print(f"[{i}/{total}] complete")
            except Exception as exc:
                error_count += 1
                _append_benchmark_log(
                    benchmark_log_path,
                    question=question,
                    expected_citations=expected_expr,
                    answer=f"[ERROR] {exc}",
                    source_ids=[],
                    prompt="",
                )
                print(f"[{i}/{total}] error: {exc}")

        completed = total - error_count
        strict_rate = (strict_hits / total) if total else 0.0
        para_rate = (para_hits / total) if total else 0.0
        avg_retrieved = (retrieved_total / completed) if completed else 0.0
        print("\nStartup embedding benchmark summary:")
        print(f"- Questions total: {total}")
        print(f"- Completed: {completed}")
        print(f"- Errors: {error_count}")
        print(f"- Strict citation hits: {strict_hits}/{total} ({strict_rate:.1%})")
        print(f"- Paragraph-level hits: {para_hits}/{total} ({para_rate:.1%})")
        print(f"- Avg retrieved citations/question: {avg_retrieved:.1f}")
        print(f"- Log file: {benchmark_log_path}")
        print("Startup embedding benchmark complete.\n")

    run_startup_embedding_benchmark()

    print("Ready. Ask questions (Ctrl+C to exit).")
    history = []
    while True:
        try:
            q = input("> ").strip()
            if not q:
                continue

            answer_text, nodes, debug_sources, used_prompt = ask(q, history)
            history.append(q)

            # Collect paragraph IDs from retrieved nodes
            source_ids = []
            for info in debug_sources:
                pid = info.get("para_id")
                if pid and pid not in source_ids:
                    source_ids.append(pid)

            text = answer_text.strip()
            _append_qa_log(q, text, source_ids, prompt=used_prompt)

            if DEBUG and source_ids:
                text += "\n\nDebug:"
                text += "\n- Retrieved (top): " + "; ".join(source_ids[:MAX_SOURCES])
                text += f"\n- Retrieved count: {len(source_ids)}"
                text += "\n- Selections:"
                for info in debug_sources[:MAX_SOURCES]:
                    pid = info.get("para_id")
                    selection = (info.get("text") or "").strip()
                    if pid and selection:
                        text += f"\n  - {pid}: {selection}"

            text += "\n\n_________\n\nAsk another question:"
            print(text)
        except KeyboardInterrupt:
            print("\nGoodbye.")
            break


if __name__ == "__main__":
    main()
