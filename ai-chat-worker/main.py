"""
TCL Companion — self-hosted AI backend
FastAPI + Ollama (Qwen 2.5 14B) + Qdrant RAG
"""
import json
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional, AsyncIterator

from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import config
import rag
import llm
import guided
import indexer
from language import normalize_language, detect_language, missing_answer, resolve_question_with_history

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("companion")

# ──────────────────────────── startup ────────────────────────────

_index_lock = asyncio.Lock()
_index_running = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Init Qdrant collection on startup
    try:
        rag.init_collection()
        count = rag.collection_count()
        log.info(f"Qdrant ready — {count} chunks")
        if count == 0:
            log.info("Empty collection — triggering first index in background")
            asyncio.create_task(_run_index())
    except Exception as e:
        log.warning(f"Qdrant init warning: {e}")
    yield


app = FastAPI(title="TCL Companion API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_origin_regex=r"https?://localhost(:\d+)?",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Sync-Secret"],
)

# ──────────────────────────── models ────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., max_length=config.MAX_QUESTION_CHARS)
    language: Optional[str] = None
    history: list[dict] = Field(default_factory=list)
    clientTime: Optional[str] = None
    utcOffsetMinutes: Optional[int] = 0


class SyncRequest(BaseModel):
    secret: Optional[str] = None

# ──────────────────────────── helpers ────────────────────────────

def _build_context(matches: list[dict]) -> str:
    used = 0
    blocks: list[str] = []
    for i, m in enumerate(matches):
        block = f"[{i+1}] {m.get('title','Untitled')}\nURL: {m.get('source_url','')}\n{m.get('chunk','').strip()}"
        if used + len(block) > config.MAX_CONTEXT_CHARS:
            break
        used += len(block)
        blocks.append(block)
    return "\n\n---\n\n".join(blocks)


async def _run_index():
    global _index_running
    async with _index_lock:
        if _index_running:
            return
        _index_running = True
    try:
        log.info("Index started")
        result = await indexer.index_all()
        log.info(f"Index done: {result}")
    except Exception as e:
        log.error(f"Index error: {e}")
    finally:
        _index_running = False

# ──────────────────────────── SSE streaming ────────────────────────────

async def _with_keepalive(source: AsyncIterator[str], interval: float = 5.0) -> AsyncIterator[str]:
    """Wraps any async generator, emitting SSE keepalive comments during gaps.
    Prevents Cloudflare / browser from closing the connection while the LLM thinks."""
    queue: asyncio.Queue = asyncio.Queue()

    async def _producer():
        try:
            async for item in source:
                await queue.put(item)
        finally:
            await queue.put(None)  # sentinel

    task = asyncio.create_task(_producer())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=interval)
                if item is None:
                    break
                yield item
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def _stream_chat(req: ChatRequest) -> AsyncIterator[str]:
    question = req.message.strip()[:config.MAX_QUESTION_CHARS]
    if not question:
        yield f"data: {json.dumps({'error': 'Empty message'})}\n\n"
        return

    # Language
    lang = normalize_language(req.language) if req.language else detect_language(question)

    # History sanitisation
    history = [
        {"role": h["role"], "content": str(h["content"])[:600]}
        for h in (req.history or [])
        if h.get("role") in ("user", "assistant") and h.get("content")
    ][-6:]

    resolved = resolve_question_with_history(question, history)
    used_context = resolved != question

    # Build actions (always)
    actions = guided.build_actions(resolved, lang)

    # 1. Guided page response (broad events)
    if not used_context:
        page_resp = guided.guided_page_response(resolved, lang, actions)
        if page_resp:
            yield f"data: {json.dumps({'token': page_resp})}\n\n"
            yield f"data: {json.dumps({'meta': {'actions': actions, 'sources': []}})}\n\n"
            yield "data: [DONE]\n\n"
            return

    # 2. Guided token response
    if not used_context:
        token_resp = guided.guided_token_response(resolved, lang)
        if token_resp:
            yield f"data: {json.dumps({'token': token_resp})}\n\n"
            yield f"data: {json.dumps({'meta': {'actions': actions, 'sources': []}})}\n\n"
            yield "data: [DONE]\n\n"
            return

    # 3. Guided loot response (always, even in follow-ups)
    drop_data = await guided.fetch_drop_data()
    loot_resp = guided.guided_loot_response(resolved, lang, drop_data)
    if loot_resp:
        yield f"data: {json.dumps({'token': loot_resp})}\n\n"
        yield f"data: {json.dumps({'meta': {'actions': actions, 'sources': []}})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # 4. Semantic cache lookup — instant return if similar question was answered before
    try:
        cached = await rag.cache_lookup(resolved, lang)
        if cached:
            log.info("Cache hit")
            yield f"data: {json.dumps({'token': cached})}\n\n"
            yield f"data: {json.dumps({'meta': {'actions': actions, 'sources': []}})}\n\n"
            yield "data: [DONE]\n\n"
            return
    except Exception as e:
        log.warning(f"Cache lookup error: {e}")

    # 5. RAG search
    try:
        matches = await rag.search(resolved, limit=config.RAG_MATCH_COUNT)
    except Exception as e:
        log.error(f"RAG search error: {e}")
        matches = []

    if not matches:
        answer = missing_answer(lang)
        yield f"data: {json.dumps({'token': answer})}\n\n"
        yield f"data: {json.dumps({'meta': {'actions': actions, 'sources': []}})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # 6. Build sources list for frontend
    sources = _build_sources(matches)

    # 7. Event context (live schedule)
    event_ctx = ""
    if req.clientTime and guided.needs_event_context(resolved):
        events_data = await guided.fetch_events_data()
        if events_data:
            event_ctx = guided.build_event_status_context(
                events_data, req.clientTime, req.utcOffsetMinutes or 0
            )

    context = _build_context(matches)

    # 8. Stream LLM response token by token
    full_answer = ""
    try:
        async for token in llm.generate_stream(resolved, context, lang, history, event_ctx):
            full_answer += token
            yield f"data: {json.dumps({'token': token})}\n\n"
    except Exception as e:
        log.error(f"LLM stream error: {e}")
        if not full_answer:
            yield f"data: {json.dumps({'token': missing_answer(lang)})}\n\n"

    # 9. Store answer in semantic cache for future similar questions
    if full_answer and len(full_answer) > 20:
        cleaned = llm.clean_answer(full_answer, lang)
        asyncio.create_task(rag.cache_store(resolved, cleaned, lang))

    # 10. Final metadata frame
    yield f"data: {json.dumps({'meta': {'actions': actions, 'sources': sources}})}\n\n"
    yield "data: [DONE]\n\n"


def _build_sources(matches: list[dict]) -> list[dict]:
    seen: set[str] = set()
    result: list[dict] = []
    for m in matches:
        url = m.get("source_url", "")
        if not url or url in seen:
            continue
        seen.add(url)
        result.append({"url": url, "title": m.get("title") or url})
        if len(result) >= 4:
            break
    return result

# ──────────────────────────── routes ────────────────────────────

@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "tcl-companion",
        "model": config.OLLAMA_MODEL,
        "chunks": rag.collection_count(),
        "index_running": _index_running,
    }


@app.post("/chat")
async def chat(req: ChatRequest):
    return StreamingResponse(
        _with_keepalive(_stream_chat(req), interval=5.0),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/sync")
async def sync(req: SyncRequest, background_tasks: BackgroundTasks):
    if config.SYNC_SECRET and req.secret != config.SYNC_SECRET:
        raise HTTPException(status_code=401, detail="Invalid sync secret")
    if _index_running:
        return {"ok": False, "message": "Index already running"}
    background_tasks.add_task(_run_index)
    return {"ok": True, "message": "Index started in background"}


@app.get("/")
async def root():
    return {"ok": True, "service": "tcl-companion", "endpoints": ["/chat", "/sync", "/health"]}
