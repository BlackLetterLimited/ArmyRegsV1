# Plan: Connecting the Frontend to JAG-GPT via FastAPI

**Goal:** The Next.js app in `web/` sends a question to a FastAPI backend; the backend calls the JAG-GPT RAG `ask` function and returns the answer (and sources) via an API, so the frontend can display streaming responses and citations.

---

## Background / Key Observations

- **Core application:** The RAG logic lives in **`Backend/AI_Work/JAG-GPT.py`** (referred to elsewhere as “JAG_GPT_API” — same app). The `ask` function is the heart of the system but is currently **nested inside `main()`**, along with all initialized objects (`retriever`, `bm25_retriever`, `reranker`, `doc_map`, `prompt_tmpl`). To call it from an API, this state and `ask` must be refactored out of `main()` so they can be reused without running the terminal REPL.

- **Frontend readiness:** The frontend (`web/lib/jag-chat.ts`) already calls a backend: it POSTs to `/api/jag-chat`, reads `NEXT_PUBLIC_BACKEND_API_BASE_URL` from env, and handles SSE streaming. No frontend code changes are required if the API matches the existing contract.

- **Request shape:** The frontend sends a body matching `JagChatRequest`: `message`, `query`, `input`, and `messages` (conversation history as `[{ role, content }]`).

- **Response shape:** The frontend expects a **streaming SSE** response. Each line is `data: <payload>`. It parses:
  - **Tokens:** Any line whose payload is a string or an object with `content` / `text` / `response` / `delta` (etc.) is treated as a text token and passed to `onToken`.
  - **Sources:** A line whose payload is a JSON object with a `sources`, `citations`, or `source_excerpts` array is parsed and passed to `onSources`. Each item is normalized to `SourceExcerpt` (e.g. `id`, `citation`, `label`, `source_id`, `regulation`, `paragraph`, `excerpt`, `chunk_id`).

- **Backend return value:** `ask(q, history)` in JAG-GPT returns `(answer_text, nodes, debug_sources, used_prompt)`. `debug_sources` is a list of `{"para_id": str, "text": str}`. The API must map these to the `SourceExcerpt`-like shape the frontend expects (e.g. `citation` / `label` from `para_id`, `excerpt` from `text`, and optionally `regulation` / `paragraph` parsed from `para_id`).

---

## Step-by-Step Plan

### 1. Install Python libraries (Backend API environment)

Install in the same Python environment you will use to run the FastAPI server (or a dedicated venv for `Backend/API`):

- **fastapi** — the API framework.
- **uvicorn** — the ASGI server that runs FastAPI.
- **python-multipart** — required by FastAPI for form/data handling.

Command:

```bash
pip install fastapi uvicorn python-multipart
```

**Note:** The API will import code from `Backend/AI_Work/JAG-GPT.py`. That module uses llama-index, ollama, HuggingFace, etc. So either:

- Run the API from the repo root (or a path where both `Backend/API` and `Backend/AI_Work` are on `sys.path`), and ensure all AI_Work dependencies are installed, or  
- Add `Backend/AI_Work` to `PYTHONPATH` when starting uvicorn and install the dependencies listed in `Backend/AI_Work/windows_requirements.txt` (or equivalent) in the same environment.

---

### 2. Refactor `Backend/AI_Work/JAG-GPT.py`

Objectives:

- Move the **ask** function and all of its dependencies out of `main()` into **module-level scope** (or a small class/singleton) so the FastAPI app can import and call `ask(question, history)` without running the terminal loop.
- Introduce an **`initialize(json_path: str)`** function that performs all one-time startup (embedding model, index build/load, retrievers, reranker, doc_map, prompt template) and stores results in **module-level variables**.
- Keep **`main()`** usable for terminal use: it calls `initialize()`, then runs the existing REPL (and optional startup benchmark) unchanged.

**2.1 — Module-level state**

- Add module-level variables to hold the state that is currently local to `main()`, for example:  
  `_retriever`, `_bm25_retriever`, `_reranker`, `_doc_map`, `_prompt_tmpl`, and optionally `_index` if needed.  
- Document in a comment that these are set by `initialize()` and read by `ask()`.

**2.2 — Extract initialization into `initialize(json_path: str)`**

- **`initialize(json_path)`** should:
  - Accept a single argument: path to the regulations JSON (e.g. `regs_combined.json`).
  - Set `Settings.llm` (Ollama client), `Settings.embed_model`, `Settings.node_parser`.
  - Load `doc_map` via `load_doc_map_from_json(json_path)` and store it in the module-level `_doc_map`.
  - Build or load the vector index (using the same cache logic as today), and store the index in a module-level variable.
  - Build `retriever`, `bm25_retriever` (if `USE_HYBRID_RETRIEVAL`), and `reranker`, and store them in module-level variables.
  - Build `prompt_tmpl` (same template as today) and store it in a module-level variable.
  - Ensure all helper functions used by `ask` (e.g. `_rerank_nodes`, `_expand_nodes`, and any others that depend on `doc_map` or `reranker`) are either moved to module level and use the module-level state, or are passed the needed dependencies explicitly.
  - **Comment:** Add a docstring describing that `initialize` performs one-time RAG setup and must be called once before calling `ask`.

**2.3 — Implement module-level `ask(question: str, history: list[str])`**

- **Signature:** `ask(question: str, history: list[str]) -> tuple[str, list, list[dict], str]`  
  Return: `(answer_text, nodes, debug_sources, used_prompt)` (same as today).
- **Behavior:** Use the module-level retriever, bm25_retriever, reranker, doc_map, and prompt_tmpl. Keep the existing logic (augment question, retrieve, rerank, expand nodes, build prompt, call LLM, build debug_sources). Do not read from stdin or print to stdout.
- **Comment:** Add a docstring: “Answers the given question using the RAG pipeline. Requires `initialize()` to have been called. Returns (answer_text, nodes, debug_sources, used_prompt).”

**2.4 — Keep `main()` for terminal use**

- At the start of `main()`, call `initialize(json_path)` (with `json_path` from `sys.argv` or `DEFAULT_JSON_PATH`).
- Leave the rest of `main()` as-is: run startup embedding benchmark if enabled, then the REPL loop that calls `ask(q, history)` and prints the result. No change to terminal I/O behavior.

**2.5 — Comments for every touched function**

- **`initialize(json_path: str)`:** One- to two-sentence description; note that it sets module-level state and must be called before `ask`.
- **`ask(question: str, history: list[str])`:** Describe purpose (RAG-based answer), precondition (initialization), and return value (answer_text, nodes, debug_sources, used_prompt).
- Any other functions moved or added (e.g. helpers used only by `ask`): brief docstring describing purpose, arguments, and return value.

---

### 3. Create `Backend/API/main.py` — FastAPI application

**3.1 — Imports and app instance**

- Import FastAPI, and the parts of `JAG-GPT` needed for initialization and asking: e.g. `initialize` and `ask` from the AI_Work module. Use a path or `sys.path` so that `Backend/AI_Work` is importable (e.g. add parent of `AI_Work` to `sys.path` before importing).
- Create the FastAPI app: `app = FastAPI()` (or with a title/description if desired).

**3.2 — Lifespan: call `initialize()` on startup**

- Use FastAPI’s **lifespan** context manager (or `@asynccontextmanager`). On **startup**: get the regulations JSON path from an environment variable (e.g. `JAG_JSON_PATH`) or default to a path relative to `Backend/AI_Work` (e.g. `regs_combined.json`). Call `initialize(json_path)`. On **shutdown**: optional cleanup (e.g. no-op for now).
- **Comment:** Document that lifespan ensures the RAG pipeline is ready before handling requests and that `JAG_JSON_PATH` can override the default JSON path.

**3.3 — CORS**

- Add CORSMiddleware to the app so the Next.js frontend (e.g. `http://localhost:3000`) can call the API. Allow the appropriate origins (e.g. `["http://localhost:3000"]` for dev), and allow methods `["POST", "GET", "OPTIONS"]` and headers `["*"]` or the ones the frontend sends.

**3.4 — POST `/api/jag-chat`**

- **Request body:** Accept a JSON body matching the frontend’s `JagChatRequest`: `message`, `query`, `input`, `messages` (list of `{ role, content }`).
- **Question and history:** Derive the question string from `body.message` or `body.query` or `body.input` (e.g. prefer `message` if present, else `query`, else `input`). Derive conversation history from `body.messages`: list of strings (e.g. the `content` of each message in order), or the format that `ask(question, history)` expects.
- **Call JAG-GPT:** In a thread pool (e.g. `run_in_executor`) or sync endpoint, call `ask(question, history)` so the blocking RAG/LLM work does not block the event loop. Handle exceptions: if `ask` raises, return 500 or 503 with an error message.
- **Response:** Return a **streaming SSE** response (`StreamingResponse`, `media_type="text/event-stream"`).
  - **Streaming strategy (choose one):**
    - **Option A (simplest):** Non-streaming from LLM. Send one SSE line: `data: <json>` where the payload is the full answer text (e.g. `{"content": answer_text}` or a plain string). Then send another SSE line with the sources payload: `data: {"sources": [...]}`. The frontend will receive the whole answer in one token chunk, then the sources.
    - **Option B:** Refactor JAG-GPT’s `ask` to optionally use the LLM’s `stream_complete` and yield tokens; then the API iterates and sends each token as an SSE line (e.g. `data: {"content": token}`). After the stream, send one final SSE line with `{"sources": [...]}`.
  - **Sources payload:** Map `debug_sources` (list of `{"para_id", "text"}`) to an array of objects that match what the frontend normalizes to `SourceExcerpt`: e.g. `citation` and `label` from `para_id`, `excerpt` from `text`, optionally `regulation` and `paragraph` parsed from `para_id` (e.g. “AR 600-20 para 1-2.a” → regulation `AR 600-20`, paragraph `1-2.a`), and `id` / `source_id` / `chunk_id` as needed so the frontend’s `normalizeSourceCandidate` is satisfied.
- **Comment:** Add a short docstring or comment for the endpoint: “Accepts JagChatRequest, runs RAG via ask(), returns SSE stream of answer chunks and a final sources event.”

**3.5 — Optional: health or readiness route**

- **GET `/health`** or **GET `/api/health`**: Return 200 if the app is running. Optionally, return 503 if `initialize()` has not been called yet (if you expose a “ready” flag).

**3.6 — Function-level comments**

- For the lifespan function, the route handler, and any helper (e.g. `debug_sources_to_sources_payload`) add a one- to two-line description of purpose and, for the handler, request/response contract.

---

### 4. Create `Backend/API/requirements.txt`

- List the Python dependencies needed to run the API server:
  - `fastapi`
  - `uvicorn`
  - `python-multipart`
- Add a comment (or separate section) that the API also depends on the `Backend/AI_Work` code and its dependencies (llama-index, ollama, transformers, etc.); those can be installed from `Backend/AI_Work/windows_requirements.txt` or the project’s main requirements file so that importing `JAG-GPT` works when running uvicorn.

---

### 5. Configure the frontend environment (`web/.env.local`)

- Create or update `web/.env.local` so the Next.js app knows where the FastAPI backend is:
  - Set **`NEXT_PUBLIC_BACKEND_API_BASE_URL=http://localhost:8000`** (or the host/port where uvicorn will run). No trailing slash.
- If you use a different port for the API, set that port in the URL. The frontend’s `getJagChatEndpoint()` will then request `http://localhost:8000/api/jag-chat` (or your base URL + `/api/jag-chat`).

---

### 6. Run and test

- **Terminal 1 — FastAPI:** From the project root (or from `Backend/API` with `PYTHONPATH` including `Backend/AI_Work`), run:  
  `uvicorn Backend.API.main:app --reload --host 0.0.0.0 --port 8000`  
  (or from `Backend/API`: `uvicorn main:app --reload --host 0.0.0.0 --port 8000` after ensuring `sys.path` or `PYTHONPATH` includes the directory containing `AI_Work` so that `from ... import initialize, ask` works.)
- **Terminal 2 — Next.js:** From `web/`, run `npm run dev` (or your usual dev command).
- **Test:** In the browser, open the chat UI, send a question. Confirm that the request goes to the FastAPI server, that the response is SSE, that the answer appears (streamed or in one chunk), and that sources appear and are displayed correctly. Check the browser network tab for `POST .../api/jag-chat` and the response body. Optionally test with a missing or invalid `NEXT_PUBLIC_BACKEND_API_BASE_URL` to confirm the frontend falls back or errors as expected.

---

## Summary of Files Touched

| File | Action |
|------|--------|
| `Backend/AI_Work/JAG-GPT.py` | Refactor: add module-level state, `initialize(json_path)`, and module-level `ask(question, history)`; keep `main()` for terminal use; add docstrings/comments for new and modified functions. |
| `Backend/API/main.py` | **Create:** FastAPI app with lifespan calling `initialize()`, CORS, POST `/api/jag-chat` that calls `ask()` and returns SSE (answer + sources), and optional health route; add comments for each function/endpoint. |
| `Backend/API/requirements.txt` | **Create:** List fastapi, uvicorn, python-multipart; note dependency on AI_Work and its requirements. |
| `web/.env.local` | **Create or update:** Set `NEXT_PUBLIC_BACKEND_API_BASE_URL` to the FastAPI server URL (e.g. `http://localhost:8000`). |

---

## Optional Enhancements (later)

- **Streaming from LLM:** Refactor `ask()` to use `stream_complete` and yield tokens so the API can stream token-by-token for a more responsive UI.
- **Authentication:** If the frontend sends `Authorization: Bearer <idToken>`, the API can verify the token and reject unauthorized requests.
- **Rate limiting:** Add rate limiting per IP or per user for `/api/jag-chat`.
- **Logging:** Log each request (question hash or length) and response status for debugging and monitoring.

---

## Comment and docstring checklist

- **JAG-GPT.py:** `initialize`, `ask`, and any moved helpers have a docstring (purpose, args, returns).
- **Backend/API/main.py:** Lifespan block, POST `/api/jag-chat` handler, and any helper (e.g. mapping debug_sources to sources JSON) have a brief comment or docstring describing their role and, for the endpoint, the request/response contract.

This plan, when implemented, will allow the Next.js application in `web/` to send a question to the FastAPI backend and receive the result of the `ask` function (answer + sources) over the existing SSE-based contract.
