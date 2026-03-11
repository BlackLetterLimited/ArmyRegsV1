"""
FastAPI application that exposes the JAG-GPT RAG pipeline via POST /api/jag-chat.
Calls initialize() on startup and streams SSE responses (answer + sources) to the frontend.
"""
import asyncio
import json
import os
import sys
import importlib.util
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Paths for JAG-GPT (loaded to avoid import errors before the app begins -- the app will likely run in a diff directory)
_API_DIR = os.path.dirname(os.path.abspath(__file__))
_AI_WORK_DIR = os.path.abspath(os.path.join(_API_DIR, "..", "AI_Work"))
_JAG_GPT_PATH = os.path.join(_AI_WORK_DIR, "JAG-GPT.py")
if _AI_WORK_DIR not in sys.path:
    sys.path.insert(0, _AI_WORK_DIR)

# Thread pool for running blocking ask() so we don't block the app between api clals and rag calls
_executor = ThreadPoolExecutor(max_workers=4)


def _load_jag_gpt():
    """Load JAG-GPT module via importlib (deferred so the app can start even if deps fail)."""
    spec = importlib.util.spec_from_file_location("jag_gpt", _JAG_GPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _get_json_path() -> str:
    """Return regulations JSON path from env or default relative to AI_Work."""
    path = os.environ.get("JAG_JSON_PATH")
    if path:
        return path
    return os.path.join(_AI_WORK_DIR, "regs_combined.json")


@asynccontextmanager
async def lifespan(app: FastAPI):
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

# CORS so the Next.js frontend (e.g. http://localhost:3000) can call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _debug_sources_to_sources_payload(debug_sources: list[dict]) -> list[dict]:
    """
    Map JAG-GPT debug_sources (list of {para_id, text}) to frontend SourceExcerpt-like
    objects (citation, label, excerpt, regulation, paragraph, id, source_id, etc.).
    """
    out = []
    for i, item in enumerate(debug_sources):
        para_id = (item.get("para_id") or "").strip()
        text = (item.get("text") or "").strip()
        # Parse "AR 600-20 para 1-2.a.(1)" into regulation and paragraph.
        reg = ""
        para = ""
        if " para " in para_id:
            parts = para_id.split(" para ", 1)
            reg = parts[0].strip()
            para = parts[1].strip() if len(parts) > 1 else ""
        else:
            reg = para_id
        out.append({
            "id": para_id or f"source-{i}",
            "source_id": para_id or f"source-{i}",
            "citation": para_id,
            "label": para_id,
            "regulation": reg,
            "paragraph": para,
            "excerpt": text,
            "chunk_id": para_id,
            "page": "",
        })
    return out


@app.post("/api/jag-chat")
async def jag_chat(request: Request):
    """
    Accepts JagChatRequest (message, query, input, messages). Runs RAG via ask(),
    returns SSE stream: one chunk with the full answer (content), then one chunk with sources.
    """
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    try:
        message = body.get("message") or body.get("query") or body.get("input") or ""
        messages = body.get("messages") or []
        history = [m.get("content", "") for m in messages if isinstance(m, dict)]
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

    def run_ask():
        return jag_gpt.ask(message.strip(), history)

    try:
        answer_text, nodes, debug_sources, used_prompt = await asyncio.get_event_loop().run_in_executor(
            _executor, run_ask
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG error: {e}")

    sources = _debug_sources_to_sources_payload(debug_sources)

    def sse_stream():
        # Send answer as one SSE line (frontend accepts one big chunk or many small).
        yield f"data: {json.dumps({'content': answer_text})}\n\n"
        # Send sources so frontend can call onSources.
        yield f"data: {json.dumps({'sources': sources})}\n\n"

    return StreamingResponse(
        sse_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.get("/health")
async def health(request: Request):
    """
    Readiness check: returns 200 only when the app is running AND JAG-GPT (RAG) is initialized.
    Returns 503 with error detail if JAG-GPT failed to load or initialize at startup.
    As a user, treat HTTP 200 as "backend is ready to accept API calls" (e.g. POST /api/jag-chat).
    """
    if request.app.state.jag_gpt is None:
        err = getattr(request.app.state, "jag_gpt_error", "JAG-GPT not initialized")
        raise HTTPException(status_code=503, detail=err)
    return {"status": "ok", "jag_gpt": "ready"}
