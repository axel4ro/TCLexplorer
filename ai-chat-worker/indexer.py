"""
Port complet al logicii de crawling și indexare din worker.js.
Funcții principale: crawl_all_sources(), index_all()
"""
import re
import json
import hashlib
import asyncio
import html as html_lib
from urllib.parse import urljoin, urlparse
from typing import Optional
import httpx
import config
import rag

IGNORED_EXTENSIONS = re.compile(
    r"\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|map|woff2?|ttf|otf|"
    r"zip|rar|7z|exe|dmg|mp4|mov|webm|mp3|wav|pdf)$", re.I
)

HEADERS = {
    "Accept": "text/html,application/json,text/plain;q=0.8,*/*;q=0.2",
    "User-Agent": "TCLexplorer-Companion RAG indexer/1.0",
}

# ──────────────────────────── text extraction ────────────────────────────

def _decode_entities(text: str) -> str:
    return html_lib.unescape(text)


def _normalize_ws(text: str) -> str:
    text = re.sub(r"\r", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def html_to_text(raw: str) -> str:
    text = re.sub(r"<!--[\s\S]*?-->", " ", raw)
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>",   " ", text, flags=re.I)
    text = re.sub(r"<noscript[\s\S]*?</noscript>", " ", text, flags=re.I)
    text = re.sub(r"<template[\s\S]*?</template>", " ", text, flags=re.I)
    text = re.sub(r"<svg[\s\S]*?</svg>",         " ", text, flags=re.I)
    text = re.sub(r"</(?:p|div|section|article|header|footer|nav|li|h[1-6]|tr|table)>",
                  "\n", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return _normalize_ws(_decode_entities(text))


def _flatten_json(value, lines: list, prefix: str = ""):
    if value is None:
        return
    if isinstance(value, list):
        for i, item in enumerate(value[:250]):
            _flatten_json(item, lines, f"{prefix} {i+1}".strip() if prefix else str(i+1))
        return
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten_json(v, lines, f"{prefix} {k}".strip() if prefix else k)
        return
    text = str(value).strip()
    if text:
        lines.append(f"{prefix}: {text}" if prefix else text)


def json_to_search_text(raw: str) -> str:
    try:
        parsed = json.loads(raw)
        lines: list[str] = []
        _flatten_json(parsed, lines)
        return _normalize_ws("\n".join(lines))
    except Exception:
        return _normalize_ws(raw)


def script_to_search_text(raw: str) -> str:
    text = re.sub(r"window\.[A-Z0-9_]+\s*=\s*window\.[A-Z0-9_]+\s*\|\|\s*\{\};?", " ", raw, flags=re.I)
    text = re.sub(r"[\"'`{}\[\]();,:]", " ", text)
    text = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), text)
    return _normalize_ws(_decode_entities(text))


def drop_json_to_search_text(raw: str) -> str:
    try:
        data = json.loads(raw)
        item_map = {i["id"]: i["name"] for i in data.get("itemTemplates", [])}
        mob_map  = {m["id"]: m["name"] for m in data.get("mobTemplates",  [])}
        lt_map   = {lt["id"]: lt       for lt in data.get("lootTables",   [])}

        lines: list[str] = []

        # Chest contents
        for item_id, lt_id in config.DROP_JSON_MANUAL_LOOT.items():
            chest_name = item_map.get(item_id)
            lt = lt_map.get(lt_id)
            if not chest_name or not lt:
                continue
            sorted_items = sorted(lt.get("items", []), key=lambda x: x["chance"])
            prev = 0.0
            parts = []
            for it in sorted_items:
                rate = round((it["chance"] - prev) * 100) / 100
                prev = it["chance"]
                name = item_map.get(it["item"], f"item{it['item']}")
                parts.append(f"{name} ({rate}%)")
            lines.append(f"{chest_name} contains: {', '.join(parts)}")

        # Mob drops
        mob_loot = data.get("mobLoot", {})
        for mob_id_str, drops in mob_loot.items():
            mob_id = int(mob_id_str)
            if mob_id in config.DROP_JSON_EXCLUDED_MOBS:
                continue
            mob_name = mob_map.get(mob_id)
            if not mob_name:
                continue
            valid_drops = [d for d in (drops if isinstance(drops, list) else []) if d.get("dropChance", 0) > 0]
            if not valid_drops:
                continue
            drop_texts: list[str] = []
            for d in valid_drops:
                lt = lt_map.get(d["lootTable"])
                if not lt:
                    continue
                items = lt.get("items", [])
                if len(items) == 1:
                    name = item_map.get(items[0]["item"])
                    if name:
                        drop_texts.append(f"{name} ({d['dropChance']}%)")
                else:
                    sorted_items = sorted(items, key=lambda x: x["chance"])
                    prev = 0.0
                    for it in sorted_items:
                        table_rate = round((it["chance"] - prev) * 100) / 100
                        prev = it["chance"]
                        if table_rate > 0:
                            name = item_map.get(it["item"])
                            if name:
                                effective = round(table_rate * d["dropChance"] / 100 * 100) / 100
                                drop_texts.append(f"{name} ({effective}%)")
            if drop_texts:
                lines.append(f"{mob_name} drops: {', '.join(drop_texts[:20])}")

        return "\n".join(lines)
    except Exception:
        return ""


# ──────────────────────────── chunking ────────────────────────────

def chunk_text(text: str, size: int = None, overlap: int = None) -> list[str]:
    size    = size    or config.CHUNK_SIZE
    overlap = overlap or config.CHUNK_OVERLAP
    normalized = _normalize_ws(text)
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + size, len(normalized))
        if end < len(normalized):
            space = normalized.rfind(" ", start, end)
            if space > start + int(size * 0.6):
                end = space
        chunk = normalized[start:end].strip()
        if len(chunk) >= 80:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(start + 1, end - overlap)
    return chunks


# ──────────────────────────── crawling ────────────────────────────

def _extract_title(raw: str, url: str) -> str:
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", raw, re.I)
    if m:
        return _decode_entities(m.group(1)).strip()[:180]
    try:
        p = urlparse(url)
        last = p.path.rstrip("/").split("/")[-1]
        return re.sub(r"\.[a-z0-9]+$", "", last, flags=re.I).replace("-", " ").replace("_", " ")
    except Exception:
        return ""


def _is_ignored_asset(path: str) -> bool:
    return bool(IGNORED_EXTENSIONS.search(path))


def _normalize_crawl_url(url: str) -> str:
    p = urlparse(url)
    return p._replace(fragment="").geturl()


def _extract_links(raw: str, current_url: str, seed_origin: str, seed_path: str) -> list[str]:
    found: set[str] = set()
    patterns = [
        re.compile(r'\b(?:href|src|data-src)=["\']([^"\']+)["\']', re.I),
        re.compile(r'["\']([^"\']+\.(?:html?|json|txt|md)(?:\?[^"\']*)?)["\']', re.I),
    ]
    for pat in patterns:
        for m in pat.finditer(raw):
            raw_link = m.group(1).strip()
            if not raw_link or raw_link.startswith(("#", "mailto:", "tel:")):
                continue
            if re.match(r"^(javascript|data|blob):", raw_link, re.I):
                continue
            try:
                full = urljoin(current_url, raw_link)
                p = urlparse(full)
                if p.scheme not in ("http", "https"):
                    continue
                if p.netloc != urlparse(seed_origin).netloc:
                    continue
                if seed_path != "/" and not p.path.startswith(seed_path):
                    continue
                if _is_ignored_asset(p.path):
                    continue
                found.add(_normalize_crawl_url(full))
            except Exception:
                continue
    return list(found)


async def crawl_url(
    url: str,
    http: httpx.AsyncClient,
    max_pages: int = 8,
    follow_links: bool = True,
) -> list[dict]:
    """Returns list of {url, title, text} pages."""
    seed = urlparse(url)
    seed_path = (seed.path.rstrip("/") + "/") if seed.path not in ("", "/") else "/"
    queue = [_normalize_crawl_url(url)]
    seen: set[str] = set()
    pages: list[dict] = []

    while queue and len(pages) < max_pages:
        current = queue.pop(0)
        if not current or current in seen:
            continue
        seen.add(current)

        try:
            resp = await http.get(current, headers=HEADERS, follow_redirects=True)
        except Exception:
            continue
        if not resp.is_success:
            continue

        ct = resp.headers.get("content-type", "")
        raw = resp.text

        title = _extract_title(raw, current)
        is_json   = "application/json"  in ct or re.search(r"\.json($|\?)", current, re.I)
        is_html   = "text/html"         in ct or re.search(r"\.html?($|\?)", current, re.I) or current.endswith("/")
        is_plain  = "text/plain"        in ct or re.search(r"\.(txt|md)($|\?)", current, re.I)
        is_script = "javascript"        in ct or re.search(r"\.m?js($|\?)",   current, re.I)

        if is_html:
            if follow_links:
                for link in _extract_links(raw, current, f"{seed.scheme}://{seed.netloc}", seed_path):
                    if link not in seen and link not in queue and len(pages) + len(queue) < max_pages * 2:
                        queue.append(link)
            text = html_to_text(raw)
            if len(text) >= 80:
                pages.append({"url": current, "title": title, "text": text})

        elif is_json:
            if "/data/drop.json" in current:
                text = drop_json_to_search_text(raw)
            else:
                text = json_to_search_text(raw)
            if len(text) >= 40:
                pages.append({"url": current, "title": title, "text": text})

        elif is_script:
            text = script_to_search_text(raw)
            if len(text) >= 40:
                pages.append({"url": current, "title": title, "text": text})

        elif is_plain:
            text = _normalize_ws(raw)
            if len(text) >= 40:
                pages.append({"url": current, "title": title, "text": text})

    return pages


def _is_tcl_explorer_url(url: str) -> bool:
    p = urlparse(url)
    return (p.netloc == "tclexplorer.com") or (
        p.netloc == "axel4ro.github.io" and p.path.startswith("/TCLexplorer")
    )


def _all_source_urls() -> list[str]:
    sources: list[str] = []
    base = config.TCL_EXPLORER_BASE
    for path in config.TCL_EXPLORER_PATHS:
        sources.append(urljoin(base, path))
    sources.extend(config.EXTRA_SOURCES)
    return sources


DYNAMIC_JSON_PATH = "/opt/tcl-companion/data/dynamic.json"
DYNAMIC_JSON_URL  = "local://dynamic.json"


def _load_dynamic_chunk() -> dict | None:
    """Load dynamic.json from disk and return a RAG-ready record, or None."""
    import os
    path = os.getenv("DYNAMIC_JSON_PATH", DYNAMIC_JSON_PATH)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None

    summary = data.get("summary_ro") or ""
    updated = data.get("updated_at", "")

    # Build a rich text representation for the vector store
    lines = [
        f"Date live TCL actualizate la {updated}.",
        summary,
        "",
    ]
    if data.get("price_usd") is not None:
        lines.append(f"Prețul TCL: {data['price_usd']} USD")
    if data.get("staking_apr") is not None:
        lines.append(f"APR staking TCL: {data['staking_apr']}%")
    if data.get("staked_tcl") is not None:
        lines.append(f"Total TCL staked: {data['staked_tcl']:,.0f} TCL")
    if data.get("daily_emission_tcl") is not None:
        lines.append(f"Emisie zilnică: {data['daily_emission_tcl']:,.0f} TCL/zi")
    if data.get("circulating_supply") is not None:
        lines.append(f"Supply circulant: {data['circulating_supply']:,.0f} TCL")
    if data.get("holders") is not None:
        lines.append(f"Holderi: {data['holders']:,}")
    if data.get("market_cap_usd") is not None:
        lines.append(f"Market cap: ${data['market_cap_usd']:,.0f} USD")
    if data.get("volume_24h_usd") is not None:
        lines.append(f"Volum 24h: ${data['volume_24h_usd']:,.0f} USD")
    if data.get("price_change_24h") is not None:
        lines.append(f"Variație preț 24h: {data['price_change_24h']}%")
    if data.get("liquidity_usd") is not None:
        lines.append(f"Lichiditate pool: ${data['liquidity_usd']:,.0f} USD")

    text = "\n".join(l for l in lines if l is not None)
    if len(text) < 40:
        return None

    content_hash = hashlib.sha256(text.encode()).hexdigest()
    return {
        "chunk":        text,
        "source_url":   DYNAMIC_JSON_URL,
        "title":        "Date live TCL (preț, APR, staking)",
        "content_hash": content_hash,
    }


async def index_all(status_cb=None) -> dict:
    """Full reindex. status_cb(msg) called with progress updates."""
    try:
        rag.init_collection()
    except Exception:
        pass

    all_sources = _all_source_urls()
    total_chunks = 0
    total_pages  = 0

    if status_cb:
        await status_cb(f"Starting index of {len(all_sources)} sources…")

    # Always index dynamic.json first (live price/APR data)
    dynamic_record = _load_dynamic_chunk()
    if dynamic_record:
        await rag.upsert_chunks([dynamic_record])
        total_chunks += 1
        if status_cb:
            await status_cb("Indexed dynamic.json (live price/APR)")

    async with httpx.AsyncClient(timeout=30) as http:
        for url in all_sources:
            is_tcl = _is_tcl_explorer_url(url)
            follow = not is_tcl
            # Whitepaper has many sub-pages; TCLexplorer paths are explicit so 1 page each
            max_p = 1 if is_tcl else 60
            try:
                pages = await crawl_url(url, http, max_pages=max_p, follow_links=follow)
            except Exception as e:
                if status_cb:
                    await status_cb(f"Skip {url}: {e}")
                continue

            total_pages += len(pages)
            records: list[dict] = []

            for page in pages:
                for chunk in chunk_text(page["text"]):
                    if total_chunks + len(records) >= config.MAX_CHUNKS:
                        break
                    content_hash = hashlib.sha256(
                        f"{page['url']}\n{chunk}".encode()
                    ).hexdigest()
                    records.append({
                        "chunk":        chunk,
                        "source_url":   page["url"],
                        "title":        page["title"],
                        "content_hash": content_hash,
                    })

            if records:
                await rag.upsert_chunks(records)
                total_chunks += len(records)
                if status_cb:
                    await status_cb(f"Indexed {url} → {len(records)} chunks")

    return {"pages": total_pages, "chunks": total_chunks}
