import argparse
import hashlib
import json
from pathlib import Path

from llama_index.core import (
    Document,
    Settings,
    StorageContext,
    VectorStoreIndex,
    load_index_from_storage,
)
from llama_index.core.node_parser import SentenceSplitter
from llama_index.embeddings.huggingface import HuggingFaceEmbedding


CHUNK_SIZE = 4000
CHUNK_OVERLAP = 100
DEFAULT_JSON_PATH = "regs_combined.json"
DEFAULT_MODELS = [
    "Alibaba-NLP/gte-large-en-v1.5",
    "sentence-transformers/all-MiniLM-L6-v2",
    "BAAI/bge-large-en-v1.5",
]
INDEX_CACHE_DIR = ".index_cache_eval"


def _display_reg(reg: str) -> str:
    reg = (reg or "").strip()
    if not reg:
        return reg
    if reg.lower().startswith("ar "):
        return reg
    return f"AR {reg}"


def _format_citation(reg: str, para: str, sub: str) -> str:
    reg_disp = _display_reg(reg)
    para = (para or "").strip()
    sub = (sub or "").strip()
    if not para:
        return reg_disp
    if sub:
        if "(" in sub and ".(" not in sub:
            idx = sub.find("(")
            if idx > 0 and sub[idx - 1].isalnum():
                sub = sub[:idx] + "." + sub[idx:]
        return f"{reg_disp} para {para}.{sub}"
    return f"{reg_disp} para {para}"


def _embed_text(reg: str, para: str, sub: str, heading_path: str, text: str) -> str:
    reg_disp = _display_reg(reg)
    para = (para or "").strip()
    sub = (sub or "").strip()
    heading_path = (heading_path or "").strip()
    header = f"{reg_disp} para {para}" + (f".{sub}" if sub else "")
    parts = [p for p in (header, heading_path, text) if p]
    return "\n".join(parts).strip()


def load_docs_from_json(json_path: str):
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
            docs.append(
                Document(
                    text=_embed_text(reg_display, para, sub, heading_path, text),
                    metadata={
                        "reg": reg_display,
                        "para": para,
                        "sub": sub,
                        "para_id": _format_citation(reg_display, para, sub),
                        "heading_path": heading_path,
                    },
                )
            )
        return docs

    for it in items:
        reg = (it.get("regulation") or "").strip()
        reg_display = _display_reg(reg)
        para = (it.get("paragraph") or "").strip()
        sub_raw = it.get("subparagraph")
        sub = sub_raw.strip() if isinstance(sub_raw, str) else ""
        text = (it.get("text") or "").strip()
        heading_path = (it.get("heading_path") or "").strip()
        if not (reg_display and para and text):
            continue
        docs.append(
            Document(
                text=_embed_text(reg_display, para, sub, heading_path, text),
                metadata={
                    "reg": reg_display,
                    "para": para,
                    "sub": sub,
                    "para_id": _format_citation(reg_display, para, sub),
                    "heading_path": heading_path,
                },
            )
        )
    return docs


def _normalize_citation(citation: str) -> str:
    return " ".join((citation or "").strip().upper().split())


def _node_para_id(node) -> str:
    md = getattr(node, "metadata", None) or getattr(getattr(node, "node", None), "metadata", None) or {}
    para_id = md.get("para_id")
    if para_id:
        return str(para_id)
    return _format_citation(md.get("reg", ""), md.get("para", ""), md.get("sub", ""))


def load_queries_tsv(path: str):
    queries = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split("\t")
        if len(parts) != 2:
            raise ValueError(
                f"Invalid line in {path!r}: expected 'query<TAB>citation', got: {line!r}"
            )
        queries.append((parts[0].strip(), parts[1].strip()))
    if not queries:
        raise ValueError(f"No queries loaded from {path!r}")
    return queries


def _parse_expected_citation_groups(expected: str):
    """
    Parse expected citation expression.

    Syntax:
    - Single citation:
      AR 600-20 para 1-1
    - Multiple required citations (AND):
      AR 600-20 para 1-1 && AR 600-20 para 2-1
    - Alternative acceptable groups (OR):
      AR 600-20 para 1-1 || AR 600-20 para 2-1
    - Combined:
      AR 600-20 para 1-1 && AR 600-20 para 2-1 || AR 600-20 para 3-1
    """
    groups = []
    for group_str in (expected or "").split("||"):
        group = {
            _normalize_citation(citation)
            for citation in group_str.split("&&")
            if citation.strip()
        }
        if group:
            groups.append(group)
    if not groups:
        raise ValueError(f"Invalid expected citation expression: {expected!r}")
    return groups


def get_or_build_index(json_path: str, model_name: str):
    json_path_obj = Path(json_path)
    cache_root = Path(INDEX_CACHE_DIR)
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_sig_src = "|".join(
        [
            str(json_path_obj.resolve()),
            str(json_path_obj.stat().st_mtime_ns),
            model_name,
            str(CHUNK_SIZE),
            str(CHUNK_OVERLAP),
        ]
    )
    cache_sig = hashlib.md5(cache_sig_src.encode("utf-8")).hexdigest()[:12]
    cache_dir = cache_root / f"{json_path_obj.stem}_{cache_sig}"

    if cache_dir.exists():
        storage_context = StorageContext.from_defaults(persist_dir=str(cache_dir))
        return load_index_from_storage(storage_context)

    docs = load_docs_from_json(json_path)
    if not docs:
        raise ValueError(f"No documents loaded from {json_path!r}")
    index = VectorStoreIndex.from_documents(docs)
    index.storage_context.persist(persist_dir=str(cache_dir))
    return index


def evaluate_model(index, queries, top_ks):
    max_k = max(top_ks)
    retriever = index.as_retriever(similarity_top_k=max_k)
    hit_counts = {k: 0 for k in top_ks}

    for question, expected_citation_expr in queries:
        expected_groups = _parse_expected_citation_groups(expected_citation_expr)
        nodes = retriever.retrieve(question)
        results = [_normalize_citation(_node_para_id(n)) for n in nodes]
        for k in top_ks:
            topk_set = set(results[:k])
            if any(group.issubset(topk_set) for group in expected_groups):
                hit_counts[k] += 1

    total = len(queries)
    return {k: (hit_counts[k], hit_counts[k] / total) for k in top_ks}


def _print_results(results, total_queries, top_ks):
    print(f"\nQueries evaluated: {total_queries}")
    print("Model".ljust(45) + " | " + " | ".join(f"Hit@{k}".ljust(16) for k in top_ks))
    print("-" * (49 + 19 * len(top_ks)))
    for model_name, metrics in results.items():
        cols = []
        for k in top_ks:
            hits, score = metrics[k]
            cols.append(f"{hits}/{total_queries} ({score:.1%})".ljust(16))
        print(model_name.ljust(45) + " | " + " | ".join(cols))


def parse_args():
    parser = argparse.ArgumentParser(
        description="Evaluate retrieval hit-rate across embedding models for regulation data."
    )
    parser.add_argument("--json-path", default=DEFAULT_JSON_PATH, help="Path to regulation JSON.")
    parser.add_argument(
        "--queries",
        required=True,
        help=(
            "TSV file with lines: question<TAB>expected citation expression "
            "(supports && for required multiple citations, || for alternatives)."
        ),
    )
    parser.add_argument(
        "--models",
        nargs="+",
        default=DEFAULT_MODELS,
        help="Embedding model names to compare.",
    )
    parser.add_argument(
        "--top-k",
        nargs="+",
        type=int,
        default=[5, 10, 20],
        help="Top-k cutoffs for hit-rate.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    queries = load_queries_tsv(args.queries)
    top_ks = sorted(set(args.top_k))

    Settings.node_parser = SentenceSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )

    results = {}
    for model_name in args.models:
        print(f"Evaluating model: {model_name}")
        try:
            Settings.embed_model = HuggingFaceEmbedding(model_name=model_name)
        except ValueError as exc:
            # Some HF embedding repos (e.g., gte-large-en-v1.5) require custom code.
            if "trust_remote_code=True" in str(exc):
                Settings.embed_model = HuggingFaceEmbedding(
                    model_name=model_name,
                    trust_remote_code=True,
                )
            else:
                raise
        index = get_or_build_index(args.json_path, model_name)
        results[model_name] = evaluate_model(index, queries, top_ks)

    _print_results(results, len(queries), top_ks)


if __name__ == "__main__":
    main()
