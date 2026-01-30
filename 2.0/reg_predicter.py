#!/usr/bin/env python3
"""
Route a user question to the most likely Army Regulation
using an Ollama model and a router.json file.

Expected router.json format:

{
  "regulations": [
    {
      "regulation": "15-6",
      "title": "Boards, Commissions, and Committees Procedures for Preliminary Inquiries, Administrative Investigations, and Boards of Officers",
      "version_date": "22 June 2025",
      "purpose": "This regulation prescribes policies and procedures for completing preliminary inquiries, administrative in- vestigations, and boards of officers.",
      "table_of_contents": [
        {
          "chapter": "1",
          "title": "General",
          "paragraphs": []
        }
      ]
    },
    ...
  ]
}
"""

import argparse
import json
import re
import textwrap
import sys
from typing import List, Tuple

import requests

# Change this if you use a different model in Ollama
OLLAMA_MODEL = "llama3.1:8b"   # or "qwen2.5", "llama3", etc.
OLLAMA_URL = "http://localhost:11434/api/chat"
ROUTER_PATH = "./data/router.json"
TOP_K_DEFAULT = 20


def load_regulations(path: str):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    regs_raw = data.get("regulations", [])
    regs = []
    for r in regs_raw:
        # Flatten chapter titles, and optionally first-level paragraph titles if present
        toc_items = []
        for ch in r.get("table_of_contents", []):
            ch_title = ch.get("title", "")
            ch_num = ch.get("chapter", "")
            if ch_num or ch_title:
                toc_items.append(f"Chapter {ch_num}: {ch_title}".strip(": "))

            # If paragraphs exist and have titles, add a few of them for context
            for p in ch.get("paragraphs", [])[:5]:
                p_num = p.get("paragraph", "") or p.get("number", "")
                p_title = p.get("title", "")
                if p_num or p_title:
                    toc_items.append(f"Para {p_num}: {p_title}".strip(": "))

        regs.append(
            {
                "reg_number": r.get("regulation", ""),
                "title": r.get("title", ""),
                "version_date": r.get("version_date", ""),
                "purpose": r.get("purpose", ""),
                "toc": toc_items,
            }
        )
    return regs


def build_reg_summary(regs, candidate_indices: List[int]):
    """
    Build a concise text description of selected regs for the model.
    """
    parts = []
    for i, idx in enumerate(candidate_indices, start=1):
        r = regs[idx]
        toc_text = "; ".join(r["toc"]) if r["toc"] else ""
        entry = f"""
        [{i}]
        Regulation: AR {r["reg_number"]}
        Title: {r["title"]}
        Version date: {r["version_date"]}
        Purpose: {r["purpose"]}
        Table of Contents (selected entries): {toc_text}
        """
        parts.append(textwrap.dedent(entry).strip())
    return "\n\n".join(parts)


def build_system_prompt():
    return textwrap.dedent(
        """
        You are a routing assistant for U.S. Army regulations.

        You will be given:
        1) A numbered list of Army regulations with their numbers, titles,
           purposes, and tables of contents.
        2) A user's question.

        Your task:
        - Determine which single regulation is most likely to contain the answer.
        - If multiple are plausible, choose the best one.
        - If none clearly apply, pick the closest.

        IMPORTANT:
        - The regulations are numbered [1], [2], [3], ...
        - You must answer ONLY with a JSON object:
          { "index": <number>, "reason": "<brief reason>" }
        - The index must be one of the numbers shown in square brackets.
        - Do NOT invent or create new regulations.
        """
    ).strip()


def build_user_prompt(question: str, regs_summary: str):
    return textwrap.dedent(
        f"""
        Here is the list of available regulations (subset):

        {regs_summary}

        ----
        User question:
        \"\"\"{question}\"\"\"

        Based on the list above, choose the SINGLE best regulation.

        Respond ONLY with JSON in this exact format:
        {{
          "index": <number>,   // the [n] from the list above
          "reason": "<brief reason>"
        }}
        """
    ).strip()


def tokenize(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def rank_regulations(question: str, regs) -> List[Tuple[int, int]]:
    q_tokens = tokenize(question)
    if not q_tokens:
        return [(i, 0) for i in range(len(regs))]

    q_set = set(q_tokens)
    scored = []
    for i, r in enumerate(regs):
        title_tokens = set(tokenize(r.get("title", "")))
        purpose_tokens = set(tokenize(r.get("purpose", "")))
        toc_tokens = set(tokenize(" ".join(r.get("toc", []))))

        score = 0
        score += 4 * len(q_set & title_tokens)
        score += 2 * len(q_set & purpose_tokens)
        score += 1 * len(q_set & toc_tokens)

        reg_num = str(r.get("reg_number", "")).strip()
        if reg_num and reg_num in question:
            score += 10

        scored.append((i, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


def find_explicit_reg(question: str, regs):
    match = re.search(r"\b(?:ar\s*)?(\d{1,3}-\d{1,3})\b", question, re.IGNORECASE)
    if not match:
        return None
    reg_num = match.group(1)
    for i, r in enumerate(regs):
        if r.get("reg_number", "") == reg_num:
            return i
    return None


def route_question(question: str, router_path: str, top_k: int):
    regs = load_regulations(router_path)

    explicit_idx = find_explicit_reg(question, regs)
    if explicit_idx is not None:
        chosen = regs[explicit_idx]
        return {
            "reg_number": chosen.get("reg_number"),
            "title": chosen.get("title"),
            "reason": "User explicitly referenced this regulation.",
        }

    ranked = rank_regulations(question, regs)
    candidate_indices = [idx for idx, _ in ranked[: max(1, min(top_k, len(ranked)))]]

    regs_summary = build_reg_summary(regs, candidate_indices)

    system_prompt = build_system_prompt()
    user_prompt = build_user_prompt(question, regs_summary)

    raw_answer = call_ollama(OLLAMA_MODEL, system_prompt, user_prompt)

    # Parse model JSON (index + reason)
    try:
        obj = json.loads(raw_answer)
    except json.JSONDecodeError:
        start = raw_answer.find("{")
        end = raw_answer.rfind("}")
        if start != -1 and end != -1 and end > start:
            obj = json.loads(raw_answer[start : end + 1])
        else:
            raise RuntimeError(f"Model output was not valid JSON:\n{raw_answer}")

    idx = obj.get("index")
    if not isinstance(idx, int) or idx < 1 or idx > len(candidate_indices):
        # Fallback to best lexical match
        best_idx = candidate_indices[0]
        chosen = regs[best_idx]
        return {
            "reg_number": chosen.get("reg_number"),
            "title": chosen.get("title"),
            "reason": "Model output invalid; using best keyword match.",
        }

    chosen = regs[candidate_indices[idx - 1]]
    return {
        "reg_number": chosen.get("reg_number"),
        "title": chosen.get("title"),
        "reason": obj.get("reason", ""),
    }

def call_ollama(model: str, system_prompt: str, user_prompt: str) -> str:
    """
    Call Ollama's /api/chat endpoint and return the model's raw message content.
    """
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
    }

    resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    return data["message"]["content"]



def parse_args():
    parser = argparse.ArgumentParser(description="Route a question to the most likely Army Regulation.")
    parser.add_argument("question", nargs="*", help="Question about Army regulations")
    parser.add_argument("--router", default=ROUTER_PATH, help="Path to router.json")
    parser.add_argument("--top-k", type=int, default=TOP_K_DEFAULT, help="Number of top candidates to send to the model")
    parser.add_argument("--model", default=OLLAMA_MODEL, help="Ollama model name")
    return parser.parse_args()


def main():
    args = parse_args()
    global OLLAMA_MODEL
    OLLAMA_MODEL = args.model

    if args.question:
        question = " ".join(args.question).strip()
    else:
        question = input("Enter your question about Army regulations:\n> ").strip()

    if not question:
        print("No question provided.")
        sys.exit(1)

    result = route_question(question, args.router, args.top_k)

    print("\nMost likely regulation:")
    print(f"  Reg number: AR {result.get('reg_number', 'Unknown')}")
    print(f"  Title:      {result.get('title', 'Unknown')}")
    print(f"  Reason:     {result.get('reason', '')}")


if __name__ == "__main__":
    main()
