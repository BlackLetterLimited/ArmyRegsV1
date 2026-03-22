"""
FastAPI application that exposes the JAG-GPT RAG pipeline via POST /api/jag-chat.
Calls initialize() on startup and streams SSE responses (sources + answer deltas) to the frontend.
"""
import asyncio
import json
import os
import re
import sys
import importlib.util
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from llama_index.core import Settings

# Paths for JAG-GPT (loaded to avoid import errors before the app begins -- the app will likely run in a diff directory)
_API_DIR = os.path.dirname(os.path.abspath(__file__))
_AI_WORK_DIR = os.path.abspath(os.path.join(_API_DIR, "..", "AI_Work"))
_JAG_GPT_PATH = os.path.join(_AI_WORK_DIR, "JAG-GPT.py")
if _AI_WORK_DIR not in sys.path:
    sys.path.insert(0, _AI_WORK_DIR)

# Thread pool for running blocking ask() so we don't block the app between api clals and rag calls
_executor = ThreadPoolExecutor(max_workers=4)


def _load_jag_gpt():
    print("Load JAG-GPT module - deferred so the app can start even if deps fail).")
    spec = importlib.util.spec_from_file_location("jag_gpt", _JAG_GPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _get_json_path() -> str:
    print("Return regulations JSON path from env or default relative to AI_Work.")
    path = os.environ.get("JAG_JSON_PATH")
    if path:
        return path
    return os.path.join(_AI_WORK_DIR, "regs_combined.json")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("On startup: load JAG-GPT module and run initialize() in a thread pool.")
    """
    On startup: load JAG-GPT module and run initialize() in a thread pool.
    If load or init fails (if there is a Python/dep mismatch), then store the error: /api/jag-chat returns 503.
    """
    app.state.jag_gpt = None
    app.state.jag_gpt_error = None

    def load_and_init():
        try:
            module = _load_jag_gpt()
            json_path = _get_json_path()
            module.initialize(json_path)
            return module
        except Exception as e:
            raise RuntimeError(f"JAG-GPT load/init failed: {e}") from e

    try:
        loop = asyncio.get_event_loop()
        app.state.jag_gpt = await loop.run_in_executor(_executor, load_and_init)
    except Exception as e:
        app.state.jag_gpt_error = str(e)
    yield


app = FastAPI(title="JAG-GPT API", lifespan=lifespan)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# Always allowed: local Next.js dev server.
# Railway: any *.up.railway.app subdomain is matched by allow_origin_regex.
# Custom domains: set CORS_ORIGINS env var (comma-separated list of origins).
#   e.g.  CORS_ORIGINS=https://regs.army,https://www.regs.army
# ---------------------------------------------------------------------------
def _build_cors_origins() -> list[str]:
    origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
    extra = os.environ.get("CORS_ORIGINS", "").strip()
    if extra:
        origins.extend([o.strip() for o in extra.split(",") if o.strip()])
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_build_cors_origins(),
    # Covers all Railway preview and production URLs automatically.
    allow_origin_regex=r"https://[\w-]+\.up\.railway\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _parse_source_fields(para_id: str) -> tuple[str, str, str]:
    citation = " ".join(para_id.strip().split())
    match = re.match(
        r"^AR\s+([0-9A-Za-z]+(?:-[0-9A-Za-z]+)+)\s+PARA\s+([0-9]+-[0-9]+)(?:\..*)?$",
        citation,
        flags=re.IGNORECASE,
    )
    if not match:
        return citation, "", ""
    return citation, match.group(1), match.group(2)


def _debug_sources_to_sources_payload(debug_sources: list[dict]) -> list[dict]:
    print("Map JAG-GPT debug_sources into minimal frontend sources JSON.")
    out = []
    for i, item in enumerate(debug_sources):
        para_id = (item.get("para_id") or "").strip()
        text = (item.get("text") or "").strip()
        page_start = item.get("page_start")
        page_end = item.get("page_end")
        page_start_str = str(page_start).strip() if page_start is not None else ""
        page_end_str = str(page_end).strip() if page_end is not None else ""
        citation, regulation, paragraph = _parse_source_fields(para_id)
        out.append({
            "id": citation or f"source-{i}",
            "citation": citation,
            "regulation": regulation,
            "paragraph": paragraph,
            "text": text,
            "page": page_start_str,
            "page_start": page_start_str,
            "page_end": page_end_str,
        })
    return out


@app.post("/api/jag-chat")
async def jag_chat(request: Request):
    print("Accepts JagChatRequest (message, query, input, messages). Runs RAG via ask(), returns SSE stream with sources first, then answer deltas.")
    """
    Accepts JagChatRequest (message, query, input, messages). Runs RAG via ask(),
    returns SSE stream with sources first, then incremental answer deltas.
    """
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    try:
        message = body.get("message") or body.get("query") or body.get("input") or ""
        messages = body.get("messages") or []
        history = [
            {
                "role": (m.get("role") or "").strip().lower(),
                "content": (m.get("content") or "").strip(),
            }
            for m in messages
            if isinstance(m, dict)
            and isinstance(m.get("content"), str)
            and (m.get("role") or "").strip().lower() in {"user", "assistant", "system"}
            and (m.get("content") or "").strip()
        ]
        if not message or not isinstance(message, str):
            raise HTTPException(status_code=400, detail="Missing or invalid 'message' or 'query'")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    jag_gpt = request.app.state.jag_gpt
    if jag_gpt is None:
        err = getattr(request.app.state, "jag_gpt_error", "JAG-GPT not initialized")
        raise HTTPException(status_code=503, detail=err)

    def run_prepare():
        return jag_gpt.prepare_stream(message.strip(), history)

    try:
        messages_for_llm, debug_sources = await asyncio.get_event_loop().run_in_executor(
            _executor, run_prepare
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG error: {e}")

    sources = _debug_sources_to_sources_payload(debug_sources)

    def sse_stream():
        llm = Settings.llm
        if llm is None:
            yield f"data: {json.dumps({'error': 'LLM not initialized'})}\n\n"
            return

        # Send sources before the model starts emitting text so the frontend can
        # convert fully streamed citation strings into chips immediately.
        yield f"data: {json.dumps({'sources': sources})}\n\n"

        try:
            for chunk in llm.stream_messages(messages_for_llm):
                # Use delta (incremental text) so the frontend can append tokens
                # without duplicating previously received content.
                delta = getattr(chunk, "delta", None)
                if not delta:
                    continue
                yield f"data: {json.dumps({'deltaText': delta})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': f'Streaming failed: {e}'})}\n\n"
            return

    return StreamingResponse(
        sse_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.get("/health")
async def health(request: Request):
    print("Readiness check: returns 200 only when the app is running AND JAG-GPT (RAG) is initialized.")
    """
    Readiness check: returns 200 only when the app is running AND JAG-GPT (RAG) is initialized.
    Returns 503 with error detail if JAG-GPT failed to load or initialize at startup.
    As a user, treat HTTP 200 as "backend is ready to accept API calls" (e.g. POST /api/jag-chat).
    """
    if request.app.state.jag_gpt is None:
        err = getattr(request.app.state, "jag_gpt_error", "JAG-GPT not initialized")
        raise HTTPException(status_code=503, detail=err)
    return {"status": "ok", "jag_gpt": "ready"}
