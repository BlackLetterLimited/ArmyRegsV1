# FastAPI Application Walkthrough

This document explains what happens in `main.py` from startup to handling a chat request.

---

## 1. When the module loads (before the server starts)

| Step | What happens |
|------|-----------------------------|
| **Paths** | `_API_DIR` is set to the folder containing `main.py` (e.g. `Backend/API`). `_AI_WORK_DIR` is set to `Backend/AI_Work`, and `_JAG_GPT_PATH` to `Backend/AI_Work/JAG-GPT.py`. |
| **sys.path** | `_AI_WORK_DIR` is added to `sys.path` so that when JAG-GPT is loaded later, it can resolve its own imports. |
| **No JAG-GPT import yet** | We do **not** import or load `JAG-GPT.py` here. That avoids pulling in `llama_index` and other heavy/breakable deps at import time (e.g. Python 3.14 issues). |
| **Thread pool** | `_executor` is a small thread pool (4 workers) used to run blocking RAG/LLM code so the async event loop is not blocked. |

---

## 2. App creation and middleware

| Step | What happens |
|------|-----------------------------|
| **FastAPI app** | `app = FastAPI(title="JAG-GPT API", lifespan=lifespan)` creates the app and wires in the lifespan (see below). |
| **CORS** | Middleware allows requests from `http://localhost:3000` and `http://127.0.0.1:3000` so the Next.js frontend can call the API. |

---

## 3. Lifespan (when the server starts)

When uvicorn starts the app, it runs the **lifespan** context manager.

| Step | What happens |
|------|-----------------------------|
| **Initialize state** | `app.state.jag_gpt = None` and `app.state.jag_gpt_error = None`. These hold the loaded JAG-GPT module (or an error message) for the rest of the app’s life. |
| **load_and_init()** | A synchronous function is defined that: (1) calls `_load_jag_gpt()` to load `JAG-GPT.py` via `importlib`, (2) gets the regulations JSON path from `_get_json_path()` (env `JAG_JSON_PATH` or default `AI_Work/regs_combined.json`), (3) calls `module.initialize(json_path)` to build/load the index and retrievers. |
| **Run in executor** | `load_and_init()` is run inside `_executor` via `run_in_executor`, so the blocking load/init does not block the async event loop. |
| **Success** | The returned module is stored in `app.state.jag_gpt`. The app is ready to serve `/api/jag-chat`. |
| **Failure** | If loading or init raises (e.g. missing deps, wrong Python version), the exception is caught and its message is stored in `app.state.jag_gpt_error`. `app.state.jag_gpt` stays `None`. The server still starts; `/api/jag-chat` will later return 503 with that error. |
| **yield** | After startup logic, `yield` runs. The server is “up” and ready to accept requests. On shutdown, code after `yield` would run (none defined here). |

---

## 4. GET /health

| Step | What happens |
|------|-----------------------------|
| **Request** | Client requests `GET /health`. |
| **Response** | Handler returns `{"status": "ok"}` with 200. No JAG-GPT or RAG involved. Use this to confirm the API process is running. |

---

## 5. POST /api/jag-chat (full flow)

| Step | What happens |
|------|-----------------------------|
| **1. Parse body** | The handler reads the JSON body with `await request.json()`. Invalid JSON → 400 with detail `"Invalid JSON body"`. |
| **2. Extract message and history** | From the body we take: `message` (or `query` or `input`) as the user question, and `messages` as the conversation history. History is turned into a list of strings (the `content` of each message). Missing or invalid message → 400. |
| **3. Check JAG-GPT is ready** | We read `request.app.state.jag_gpt`. If it is `None` (load/init failed at startup), we return **503** with `detail=app.state.jag_gpt_error` so the client sees why the backend is unavailable. |
| **4. Call RAG in thread pool** | We define `run_ask()` which calls `jag_gpt.ask(message.strip(), history)`. That runs retrieval, reranking, prompt building, and the LLM call. We run `run_ask()` via `run_in_executor(_executor, ...)` so the blocking RAG/LLM work does not block the event loop. |
| **5. RAG result** | `ask()` returns `(answer_text, nodes, debug_sources, used_prompt)`. We use `answer_text` and `debug_sources`. If `ask()` raises → 500 with detail `"RAG error: ..."`. |
| **6. Map sources for frontend** | `_debug_sources_to_sources_payload(debug_sources)` converts each `{para_id, text}` into a frontend-friendly object with `id`, `citation`, `label`, `regulation`, `paragraph`, `excerpt`, `chunk_id`, `page`, etc. |
| **7. Stream SSE response** | We return a `StreamingResponse` with `media_type="text/event-stream"`. The generator first yields one SSE line: `data: {"content": "<answer_text>"}`, then a second: `data: {"sources": [ ... ]}`. The frontend can parse these for tokens and sources (e.g. `onToken` and `onSources`). |

---

## 6. Helper functions (when they run)

| Function | When it runs | Purpose |
|----------|----------------|--------|
| `_load_jag_gpt()` | Inside lifespan, from `load_and_init()` | Loads `JAG-GPT.py` via importlib so the filename hyphen is OK and deps are not loaded at module import time. |
| `_get_json_path()` | Inside lifespan and (conceptually) when building default path | Returns `JAG_JSON_PATH` from env, or default path to `regs_combined.json` under `_AI_WORK_DIR`. |
| `_debug_sources_to_sources_payload(debug_sources)` | In `/api/jag-chat` after `ask()` returns | Converts JAG-GPT’s `debug_sources` list into the structure the frontend expects for citations/sources. |

---

## 7. End-to-end summary

1. **Server start** → Lifespan runs → JAG-GPT is loaded and initialized in a thread (or error stored). App state is set; server is ready.
2. **GET /health** → Returns `{"status":"ok"}`.
3. **POST /api/jag-chat** → Parse body → ensure JAG-GPT is loaded → run `ask(question, history)` in thread pool → map sources → stream SSE (answer chunk, then sources chunk).

The design keeps heavy/optional JAG-GPT loading out of import time (so the app can start even if deps fail), runs blocking RAG in a thread pool (so the server stays responsive), and returns a clear 503 with `jag_gpt_error` when the RAG backend is not available.
