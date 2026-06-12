import re
import hashlib
import asyncio
import httpx
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    NamedVector,
)
import config

_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=config.QDRANT_URL, timeout=30)
    return _client


def init_collection():
    client = get_client()
    existing = [c.name for c in client.get_collections().collections]
    if config.QDRANT_COLLECTION not in existing:
        client.create_collection(
            collection_name=config.QDRANT_COLLECTION,
            vectors_config=VectorParams(size=config.VECTOR_SIZE, distance=Distance.COSINE),
        )


async def get_embedding(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(
            f"{config.OLLAMA_URL}/api/embed",
            json={"model": config.OLLAMA_EMBED_MODEL, "input": text},
        )
        resp.raise_for_status()
        data = resp.json()
        # Ollama returns {"embeddings": [[...]]} for /api/embed
        embeddings = data.get("embeddings") or data.get("embedding")
        if isinstance(embeddings[0], list):
            return embeddings[0]
        return embeddings


async def search(query: str, limit: int = None) -> list[dict]:
    limit = limit or config.RAG_MATCH_COUNT
    vector = await get_embedding(query)
    client = get_client()
    response = client.query_points(
        collection_name=config.QDRANT_COLLECTION,
        query=vector,
        limit=min(limit * 3, 20),  # fetch more for reranking
        with_payload=True,
        score_threshold=0.3,
    )
    results = response.points
    raw = [
        {
            "chunk": r.payload.get("chunk", ""),
            "source_url": r.payload.get("source_url", ""),
            "title": r.payload.get("title", ""),
            "rank": r.score,
            "id": str(r.id),
        }
        for r in results
        if r.payload.get("chunk")
    ]
    return _rerank(query, raw, limit)


def _tokenize(text: str) -> set[str]:
    stop = {
        "the", "and", "for", "with", "from", "that", "this", "are", "you",
        "what", "when", "where", "which", "how", "why", "does", "can", "is",
        "a", "an", "of", "to", "in",
        "cum", "care", "unde", "cand", "când", "cat", "cât", "cati", "câti",
        "cate", "câte", "este", "sunt", "pentru", "despre", "din", "sau",
        "mai", "pot",
    }
    tokens = re.split(r"[^a-z0-9ăâîșşțţ]+", text.lower())
    return {t for t in tokens if len(t) >= 3 and t not in stop}


def _rerank(question: str, rows: list[dict], limit: int) -> list[dict]:
    query_tokens = _tokenize(question)
    legal_intent = bool(re.search(
        r"\b(privacy|terms|conditions|eula|legal|policy|gdpr)\b", question, re.I
    ))
    is_events = bool(re.search(
        r"\b(events?|weekly|schedule|calendar|eveniment|saptamanal|săptămânal|program)\b",
        question, re.I,
    ))
    is_loot = bool(re.search(
        r"\b(contine|contains|inside|ce.*in|what.*in)\b", question, re.I
    ) and re.search(
        r"\b(chest|clam|moonlight|cufar|comori|treasure|box|crystal)\b", question, re.I
    ))

    per_url: dict[str, int] = {}
    scored = []
    for row in rows:
        url   = row.get("source_url", "")
        title = row.get("title", "")
        hay   = f"{title} {row.get('chunk', '')}"

        hay_tok   = _tokenize(hay)
        title_tok = _tokenize(title)
        overlap       = sum(1 for t in query_tokens if t in hay_tok)
        title_overlap = sum(1 for t in query_tokens if t in title_tok)

        score = row["rank"] + overlap * 0.12 + title_overlap * 0.18

        if "whitepaper.thecursedland.com" in url:
            score += 0.08
        if "axel4ro.github.io/TCLexplorer" in url:
            score += 0.04
        if is_events and re.search(r"weekly_events\.json|events\.bundle", url, re.I):
            score += 0.75
        if is_loot and "/data/drop.json" in url:
            score += 0.80
        if not legal_intent and re.search(
            r"\b(eula|privacy|terms|conditions|policy)\b", f"{title} {url}", re.I
        ):
            score -= 0.45

        scored.append({**row, "rank": round(score, 6)})

    scored.sort(key=lambda r: r["rank"], reverse=True)

    result = []
    for row in scored:
        key = row.get("source_url") or row.get("id", "")
        count = per_url.get(key, 0)
        if count >= 2:
            continue
        per_url[key] = count + 1
        result.append(row)
        if len(result) >= limit:
            break
    return result


async def upsert_chunks(chunks: list[dict]):
    """chunks: list of {chunk, source_url, title, content_hash}"""
    if not chunks:
        return

    # Embed in small batches to avoid timeouts
    batch_size = 16
    points: list[PointStruct] = []

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        texts = [c["chunk"] for c in batch]

        # Batch embed via Ollama
        async with httpx.AsyncClient(timeout=60) as http:
            resp = await http.post(
                f"{config.OLLAMA_URL}/api/embed",
                json={"model": config.OLLAMA_EMBED_MODEL, "input": texts},
            )
            resp.raise_for_status()
            data = resp.json()
            embeddings = data.get("embeddings", [])

        for chunk, vector in zip(batch, embeddings):
            uid = int(hashlib.sha256(chunk["content_hash"].encode()).hexdigest()[:16], 16)
            # Qdrant point IDs must be unsigned 64-bit; take modulo
            uid = uid % (2**63)
            points.append(PointStruct(
                id=uid,
                vector=vector if isinstance(vector, list) else vector,
                payload={
                    "chunk":       chunk["chunk"],
                    "source_url":  chunk.get("source_url", ""),
                    "title":       chunk.get("title", ""),
                    "content_hash": chunk["content_hash"],
                },
            ))

    client = get_client()
    # Upsert in batches of 100
    for i in range(0, len(points), 100):
        client.upsert(
            collection_name=config.QDRANT_COLLECTION,
            points=points[i : i + 100],
            wait=True,
        )


def collection_count() -> int:
    try:
        info = get_client().get_collection(config.QDRANT_COLLECTION)
        return info.points_count or 0
    except Exception:
        return 0
