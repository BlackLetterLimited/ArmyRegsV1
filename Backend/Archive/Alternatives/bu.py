import sys
import json
from pathlib import Path

from llama_index.core import VectorStoreIndex, Settings, Document
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

CHUNK_SIZE = 220
CHUNK_OVERLAP = 40
TOP_K = 4


def load_docs_from_json(json_path: str):
    """Load JSON of the form:
    [
      {
        "regulation": "AR 670-1",
        "paragraph": "1-1",
        "subparagraph": null,
        "text": "..."
      },
      ...
    ]
    """
    items = json.loads(Path(json_path).read_text(encoding="utf-8"))
    docs = []
    for it in items:
        reg = (it.get("regulation") or "").strip()
        para = (it.get("paragraph") or "").strip()
        sub_raw = it.get("subparagraph")
        # Keep sub as string for indexing, but remember original structure in para_id
        sub = sub_raw.strip() if isinstance(sub_raw, str) else ""
        text = (it.get("text") or "").strip()
        if not (reg and para and text):
            continue
        pid = f"{reg} para {para}" + (f" {sub}" if sub else "")
        docs.append(
            Document(
                text=text,
                metadata={
                    "reg": reg,
                    "para": para,
                    "sub": sub,      # original JSON's subparagraph (string or "")
                    "para_id": pid,  # for human-readable source display
                },
            )
        )
    return docs


def format_node(n):
    """Helper for human-readable source lines."""
    md = n.metadata or {}
    reg = md.get("reg", "")
    para = md.get("para", "")
    sub_val = md.get("sub", "")
    sub = f" {sub_val}" if sub_val else ""
    header = f"[SOURCE AR {reg} para {para}{sub}]\n"
    return header + n.get_content()


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

    docs = load_docs_from_json(json_path)
    if not docs:
        print("No documents loaded from JSON.")
        sys.exit(1)

    index = VectorStoreIndex.from_documents(docs)

    # Prompt explicitly matches your JSON hierarchy: regulation / paragraph / subparagraph / text
    prompt_tmpl = PromptTemplate(
"""
You are an AI assistant that answers questions about U.S. Army regulations.

Your PRIMARY authority is the "Regulation Excerpts JSON" provided below.
You may optionally use your general knowledge or external information, but ONLY to:
- Clarify or explain the meaning of the provided regulation text.
- Provide reasonable examples or context.

You MUST NOT:
- Contradict or override the meaning of the provided regulation excerpts.
- Invent regulation or paragraph numbers that are not present in the JSON.
- Fabricate quotes from regulations.
- Treat general knowledge as if it were regulation text.

If there is a conflict between general knowledge and the JSON, you MUST follow the JSON.

Inputs You Will Receive

1. User question (natural language):
{QUESTION}

2. Matched regulation excerpts from the JSON library in a structured format, each with:
- regulation (e.g., "AR 670-1")
- paragraph (e.g., "1-2" or "3-5.b(2)")
- subparagraph (may be null)
- text (the full paragraph or subparagraph text)

Example structure:

{{
    "matches": [
    {{
        "regulation": "AR 670-1",
        "paragraph": "3-15",
        "subparagraph": "f",
        "text": "..."
    }},
    {{
        "regulation": "AR 670-1",
        "paragraph": "1-2",
        "subparagraph": null,
        "text": "..."
    }}
    ]
}}

Assume that all binding law and policy you may use is contained inside these JSON excerpts.
General knowledge can only be used as non-binding explanatory context.

Hard Constraints

1. Citations:
   - Only cite regulation + paragraph combinations that actually appear in the JSON excerpts.
   - Use this format: "According to AR 670-1, para 1-2, ..."
   - If multiple paragraphs apply, you may cite more than one:
     "According to AR 670-1, paras 1-1 and 1-2, ..."

2. Use the regulation’s actual language:
   - Quote or closely paraphrase key language from the paragraphs that appear in the JSON.
   - Use quotation marks for direct quotes.
   - Do NOT fabricate language that is not present or fairly implied.

3. General knowledge:
   - You MAY add a short explanatory sentence like:
     "In general Army practice, ..." or "Outside the text provided, it is commonly understood that ..."
   - You MUST clearly distinguish this from what the regulation text itself says.
   - Never present general knowledge as if it were quoted or paraphrased regulation text.

4. No placeholders:
   - Do NOT output bracketed placeholders like "[insert key quoted language]" or "[short restatement of rule]".
   - Always use real language or omit that part.

Required Answer Format

Always answer using this structure:

1. Bottom-line answer
   - Example: "Yes, but with limitations.", "No.", "It depends.", or
     "The provided excerpts do not clearly address this question."

2. Regulation-based analysis
   - Clearly cite the relevant regulation(s) and paragraph(s) that appear in the JSON.
   - Briefly quote or closely paraphrase key language from those excerpts.
   - Explain how that text applies to the user’s situation.
   - If helpful, add a short paragraph on supplemental context from general knowledge but make sure this does NOT contradict the cited regulation text.

If no excerpts are clearly relevant, use something like:

"The provided regulation excerpts do not clearly address ..."

You must now answer the following question, following all of the rules above:

Question: {QUESTION}
Regulation Excerpts JSON:
{MATCHED_RULES}
"""
    )

    retriever = index.as_retriever(similarity_top_k=TOP_K)
    reranker = SbertRerank(model="cross-encoder/ms-marco-MiniLM-L-6-v2", top_n=3)

    def ask(q: str):
        nodes = retriever.retrieve(q)

        # Optional reranking; uncomment if desired
        # nodes = reranker.postprocess_nodes(nodes, query=q)

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
            md = n.metadata or {}
            regulation = (md.get("reg") or "").strip()
            paragraph = (md.get("para") or "").strip()
            sub_str = (md.get("sub") or "").strip()
            # Represent absent subparagraph as null in JSON, not empty string
            subparagraph = sub_str if sub_str else None

            matches.append(
                {
                    "regulation": regulation,
                    "paragraph": paragraph,
                    "subparagraph": subparagraph,
                    "text": n.get_content().strip(),
                }
            )

        matches_json = json.dumps({"matches": matches}, indent=2)

        prompt = prompt_tmpl.format(
            QUESTION=q,
            MATCHED_RULES=matches_json,
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
