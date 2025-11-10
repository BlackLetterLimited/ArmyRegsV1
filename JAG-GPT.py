import sys
import json
from pathlib import Path

from llama_index.core import VectorStoreIndex, Settings, Document
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.prompts import PromptTemplate
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

# Reranker import (try this first on v0.10+)
##try:
#    from llama_index.postprocessor.rankers import SentenceTransformerRerank as SbertRerank
#except Exception:
    # fallback for other versions
#    from llama_index.postprocessor import SentenceTransformerRerank as SbertRerank
##

# Config
BASE_URL = "http://localhost:11434"
LLM_NAME = "qwen2"  # or "llama3", "qwen2"
HF_EMB_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # small, fast CPU embedding

CHUNK_SIZE = 220
CHUNK_OVERLAP = 40
TOP_K = 12


def load_docs_from_json(json_path: str):
    items = json.loads(Path(json_path).read_text(encoding="utf-8"))
    docs = []
    for it in items:
        reg = (it.get("regulation") or "").strip()
        para = (it.get("paragraph") or "").strip()
        sub = (it.get("subparagraph") or "")
        sub = sub.strip() if isinstance(sub, str) else ""
        text = (it.get("text") or "").strip()
        if not (reg and para and text):
            continue
        # Compose citation-friendly id
        pid = f"{reg} para {para}" + (f" {sub}" if sub else "")
        docs.append(
            Document(
                text=text,
                metadata={
                    "reg": reg,
                    "para": para,
                    "sub": sub,
                    "para_id": pid,
                },
            )
        )
    return docs

def format_node(n):
    md = n.metadata or {}
    reg = md.get("reg","")
    para = md.get("para","")
    sub_val = md.get('sub','')
    sub = f" {sub_val}" if sub_val else ""
    header = f"[SOURCE AR {reg} para {para}{sub}]\n"
    return header + n.get_content()

def main():
    if len(sys.argv) < 2:
        print("Usage: python rag_ollama_ar_json.py /path/to/AR_by_id.json")
        sys.exit(1)
    json_path = sys.argv[1]

    # LLM via Ollama; Embeddings via HuggingFace (avoids Ollama embedding endpoint)
    Settings.llm = Ollama(model=LLM_NAME, base_url=BASE_URL, request_timeout=120, temperature=0.1)
    Settings.embed_model = HuggingFaceEmbedding(model_name=HF_EMB_MODEL)
    Settings.node_parser = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)

    docs = load_docs_from_json(json_path)
    if not docs:
        print("No documents loaded from JSON.")
        sys.exit(1)

    index = VectorStoreIndex.from_documents(docs)

    prompt_tmpl = PromptTemplate(
        "You are answering questions about Army regulations. If doing so makes sense, start with a one-word verdict: Yes or No. "
        "Then give a brief explanation using the most directly applicable rule from the context. "
        "Prefer explicit permission/prohibition language (e.g., 'authorized', 'prohibited', 'may not', 'will not'). "
        "Do not infer beyond the provided context. Cite the rule(s) you relied on with square brackets like "
        "[AR {reg} para {para}{sub}] at the end of the sentence. Use at most two citations.\n\n"
        "Question: {query}\n\n"
        "Context:\n{context_str}\n\n"
        "Answer:"
    )

    # Custom retriever + reranker + formatted context
    retriever = index.as_retriever(similarity_top_k=TOP_K)
    #reranker = SbertRerank(model="cross-encoder/ms-marco-MiniLM-L-6-v2", top_n=3)

    def ask(q: str):
        nodes = retriever.retrieve(q)
        #if reranker:
        #    nodes = reranker.postprocess_nodes(nodes, query=q)

        context_str = "\n\n".join(format_node(n) for n in nodes)

        # keep {reg},{para},{sub} literal inside the example citation line
        prompt = prompt_tmpl.format(
            query=q,
            context_str=context_str,
            reg="{reg}",
            para="{para}",
            sub="{sub}",
        )
        llm = Settings.llm
        resp = llm.complete(prompt)
        return str(resp), nodes

    print("Ready. Ask questions (Ctrl+C to exit).")
    while True:
        try:
            q = input("> ").strip()
            if not q:
                continue

            answer_text, nodes = ask(q)

            # Collect paragraph IDs from retrieved nodes
            source_ids = []
            for n in nodes:
                pid = (n.metadata or {}).get("para_id")
                if pid and pid not in source_ids:
                    source_ids.append(pid)

            text = answer_text.strip()
            if ("[" not in text or "]" not in text) and source_ids:
                text += "\n\nSources: " + ", ".join(f"[{pid}]" for pid in source_ids)

            print(text)
        except KeyboardInterrupt:
            print("\nGoodbye.")
            break


if __name__ == "__main__":
    main()
