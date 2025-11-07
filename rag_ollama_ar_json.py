#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RAG over Army Regulation paragraphs (JSON map) with Ollama LLM and HuggingFace embeddings.
Returns answers with paragraph-ID citations like [3–5 b. (1)].

Prereqs:
  - ollama running locally (http://localhost:11434)
  - ollama pull mistral
  - pip install -U llama-index-core llama-index-llms-ollama llama-index-embeddings-huggingface \
        transformers sentence-transformers

Run:
  python rag_ollama_ar_json.py /path/to/AR_by_id.json
"""

import sys
import json
from pathlib import Path

from llama_index.core import VectorStoreIndex, Settings, Document
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.prompts import PromptTemplate
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.huggingface import HuggingFaceEmbedding


# Config
BASE_URL = "http://localhost:11434"
LLM_NAME = "qwen2"  # or "llama3", "qwen2"
HF_EMB_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # small, fast CPU embedding

CHUNK_SIZE = 300
CHUNK_OVERLAP = 200
TOP_K = 2


def load_docs_from_json(json_path: str):
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    docs = []
    for para_id, text in data.items():
        t = (text or "").strip()
        if not t:
            continue
        docs.append(Document(text=t, metadata={"para_id": para_id}))
    return docs


def main():
    if len(sys.argv) < 2:
        print("Usage: python rag_ollama_ar_json.py /path/to/AR_by_id.json")
        sys.exit(1)
    json_path = sys.argv[1]

    # LLM via Ollama; Embeddings via HuggingFace (avoids Ollama embedding endpoint)
    Settings.llm = Ollama(model=LLM_NAME, base_url=BASE_URL, request_timeout=120)
    Settings.embed_model = HuggingFaceEmbedding(model_name=HF_EMB_MODEL)
    Settings.node_parser = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)

    docs = load_docs_from_json(json_path)
    if not docs:
        print("No documents loaded from JSON.")
        sys.exit(1)

    index = VectorStoreIndex.from_documents(docs)

    prompt_tmpl = PromptTemplate(
        "answer the question as an attorney, giving clear responses but referencing the context as a source."
        "After each claim, cite paragraph ids in square brackets: [AR 670-1 para 3–5 b.(1)]."
        "If the answer is not supported by the Context, say 'I cannot find this in the provided context.'"
        "If the question specifies a gender, answer only for that gender."
        "Question: {query}\n\nContext:\n{context_str}\n\nAnswer (with citations):"
    )

    query_engine = index.as_query_engine(
        similarity_top_k=TOP_K,
        text_qa_template=prompt_tmpl,
    )

    print("Ready. Ask questions (Ctrl+C to exit).")
    while True:
        try:
            q = input("> ").strip()
            if not q:
                continue

            resp = query_engine.query(q)

            # Collect paragraph IDs from sources (version-tolerant)
            source_ids = []
            for s in getattr(resp, "source_nodes", []):
                pid = None
                if hasattr(s, "node") and getattr(s.node, "metadata", None):
                    pid = s.node.metadata.get("para_id")
                if not pid and getattr(s, "metadata", None):
                    pid = s.metadata.get("para_id")
                if pid and pid not in source_ids:
                    source_ids.append(pid)

            text = str(resp).strip()
            if ("[" not in text or "]" not in text) and source_ids:
                text += "\n\nSources: " + ", ".join(f"[{pid}]" for pid in source_ids)

            print(text)
        except KeyboardInterrupt:
            print("\nGoodbye.")
            break


if __name__ == "__main__":
    main()
