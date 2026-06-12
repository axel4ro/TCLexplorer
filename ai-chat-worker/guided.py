"""
Port complet al răspunsurilor ghidate din worker.js:
buildActions, guidedPageResponse, guidedTokenResponse,
guidedLootContentsResponse, buildEventStatusContext.
"""
import re
import json
import math
from datetime import datetime, timezone, timedelta
from typing import Optional
import httpx
import config

WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# ──────────────────────────── intent helpers ────────────────────────────

def is_events_intent(q: str) -> bool:
    return bool(re.search(
        r"\b(events?|event|weekly|schedule|calendar|eveniment\w*|saptamanal|săptămânal)\b",
        q, re.I
    ) or (re.search(r"\b(program(ul)?)\b", q, re.I)
          and not re.search(r"\b(creator|referral|afiliat|earn|staking|reward)\b", q, re.I)))


def is_broad_events_intent(q: str) -> bool:
    text = q.strip().lower()
    if not is_events_intent(text):
        return False
    if re.search(
        r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
        r"luni|marti|marți|miercuri|joi|vineri|sambata|sâmbătă|duminica|duminică|"
        r"today|azi|acum|now|next|urmator|următor|forge|experience|clam|moonlight|crystal|drop)\b",
        text, re.I
    ):
        return False
    return len(text.split()) <= 8 or bool(re.search(
        r"\b(what events|events list|ce evenimente|lista.*evenimente)\b", text, re.I
    ))


def is_requirements_intent(q: str) -> bool:
    return bool(re.search(
        r"\b(game.?req|system.?req|can.?i.?run|pot.?rula|hardware|pc.?spec|"
        r"minimum.?req|cerinte.?joc|cerinte.?sistem|configuratie|configurație|specificat|specs?)\b",
        q, re.I
    ) or (re.search(r"\b(requirements?|cerinte|cerință|cerințe)\b", q, re.I)
          and not re.search(r"\b(item|upgrade|wiki|plus)\b", q, re.I)))


def is_buy_token_intent(q: str) -> bool:
    q = q.lower()
    return bool(
        re.search(r"\b(buy|cumpara|cumpăr|purchase|achizit|unde cumpar|how to get|"
                  r"how to buy|get tcl|exchange|swap|schimb|sell|vinde)\b", q, re.I)
        and re.search(r"\b(tcl|token)\b", q, re.I)
    )


def is_token_info_intent(q: str) -> bool:
    return bool(re.search(
        r"\b(ce.?este.?tcl|what.?is.?tcl|about.?tcl|despre.?tcl|"
        r"tcl.?token|token.?tcl|tcl.?coin|crypto.?tcl|tcl.?price|pret.?tcl|preț.?tcl)\b",
        q, re.I
    ))


def detect_chest(q: str) -> Optional[int]:
    q = q.lower()
    if "spider"                                            in q: return 1775
    if re.search(r"gold.*\+|gold.*plus|gold.*chest.*\+",   q): return 1773
    if "christmas"                                         in q: return 1509
    if "flower"                                            in q: return 1212
    if "crystal"                                           in q: return 1213
    if "clam"                                              in q: return 1517
    if re.search(r"gold.*(chest|cufar|comori)|(chest|cufar|comori).*gold", q): return 1422
    if "moonlight"                                         in q: return 1211
    return None


def is_loot_contents_intent(q: str) -> bool:
    return bool(
        re.search(r"\b(contine|contains|inside|ce.*in|what.*in|what.*inside|drops?|drop)\b", q, re.I)
        and re.search(r"\b(chest|clam|moonlight|cufar|comori|treasure|box|crystal|"
                      r"gold.*chest|christmas|spider|flower)\b", q, re.I)
    )

# ──────────────────────────── actions ────────────────────────────

def _t(lang: str, translations: dict) -> str:
    return translations.get(lang, translations.get("en", ""))


def build_actions(question: str, language: str) -> list[dict]:
    actions: list[dict] = []
    seen_urls: set[str] = set()

    def add(title: str, url: str, kind: str = "secondary"):
        if url not in seen_urls and len(actions) < 4:
            seen_urls.add(url)
            actions.append({"title": title, "url": url, "kind": kind})

    lang = language

    _is_specific_event = bool(re.search(
        r"\b(moonlight|clam|crystal|forge|experience|fishing|crystals.frenzy|"
        r"cufar|comori|treasure.chest|eveniment\w*)\b",
        question, re.I
    ))
    if is_events_intent(question) or _is_specific_event:
        add(_t(lang, {
            "en": "Open Events", "ro": "Deschide Evenimente", "tr": "Etkinlikleri Aç",
            "de": "Events öffnen", "es": "Abrir Eventos", "fr": "Ouvrir les événements",
            "it": "Apri Eventi", "pl": "Otwórz Wydarzenia", "pt": "Abrir Eventos",
        }), "https://tclexplorer.com/#events", "primary")

    if re.search(r"\b(wiki|iteme?|items?\b|obiecte?|blacksmith|upgrade|plusat)\b", question, re.I):
        add(_t(lang, {
            "en": "Open Wiki", "ro": "Deschide Wiki", "tr": "Wiki'yi Aç",
            "de": "Wiki öffnen", "es": "Abrir Wiki", "fr": "Ouvrir Wiki",
            "it": "Apri Wiki", "pl": "Otwórz Wiki", "pt": "Abrir Wiki",
        }), "https://tclexplorer.com/#wiki", "primary")

    if re.search(r"\b(loot|drop|drops?|clam|moonlight|cufere?|scoici|chest|treasure)\b", question, re.I):
        add(_t(lang, {
            "en": "Open Loot", "ro": "Deschide Loot", "tr": "Loot'u Aç",
            "de": "Loot öffnen", "es": "Abrir Loot", "fr": "Ouvrir Loot",
            "it": "Apri Loot", "pl": "Otwórz Loot", "pt": "Abrir Loot",
        }), "https://tclexplorer.com/loot.html", "primary")

    if is_requirements_intent(question):
        add(_t(lang, {
            "en": "Can I Run It", "ro": "Pot Rula Jocul", "tr": "Çalıştırabilir miyim",
            "de": "Kann ich es spielen", "es": "¿Puedo correrlo?", "fr": "Puis-je le lancer",
            "it": "Posso eseguirlo", "pl": "Czy uruchomię grę", "pt": "Consigo rodar",
        }), "https://tclexplorer.com/CanIrunIt.html", "primary")

    if is_buy_token_intent(question) or is_token_info_intent(question):
        add("xExchange", "https://xexchange.com/", "primary")
        add("xPortal",   "https://xportal.com/")

    if re.search(r"\b(nfts?)\b", question, re.I):
        add(_t(lang, {
            "en": "Open NFTs", "ro": "Deschide NFT-uri", "tr": "NFT'leri Aç",
            "de": "NFTs öffnen", "es": "Abrir NFTs", "fr": "Ouvrir NFTs",
            "it": "Apri NFTs", "pl": "Otwórz NFTs", "pt": "Abrir NFTs",
        }), "https://tclexplorer.com/NFTs.html", "primary")

    if re.search(r"\b(earn|staking|apr\b|reward|recompens|castig|câștig|creator|referral|afiliat|"
                 r"bani|procent|percent|comision|commission)\b", question, re.I):
        add(_t(lang, {
            "en": "Open Earn", "ro": "Deschide Earn", "tr": "Earn'i Aç",
            "de": "Earn öffnen", "es": "Abrir Earn", "fr": "Ouvrir Earn",
            "it": "Apri Earn", "pl": "Otwórz Earn", "pt": "Abrir Earn",
        }), "https://tclexplorer.com/earn.html", "primary")

    if re.search(r"\b(xportal|portofel|wallet|connect|conectare|web3)\b", question, re.I) \
            and not is_buy_token_intent(question):
        add(_t(lang, {
            "en": "Connect xPortal", "ro": "Conectează xPortal", "tr": "xPortal Bağla",
            "de": "xPortal verbinden", "es": "Conectar xPortal", "fr": "Connecter xPortal",
            "it": "Connetti xPortal", "pl": "Połącz xPortal", "pt": "Conectar xPortal",
        }), "https://tclexplorer.com/connect_xportal.html")

    if re.search(r"\b(analytics|statistic|statistici)\b", question, re.I):
        add(_t(lang, {
            "en": "Open Analytics", "ro": "Deschide Analytics",
        }), "https://tclexplorer.com/analytics.html")

    if re.search(r"\b(trade[sd]?|tranzact|volum\b|volume\b)\b", question, re.I) \
            and not is_buy_token_intent(question):
        add(_t(lang, {
            "en": "TCL Trades", "ro": "Tranzacții TCL",
        }), "https://tclexplorer.com/TCL_trades.html")

    return actions[:4]

# ──────────────────────────── guided responses ────────────────────────────

def guided_page_response(question: str, language: str, actions: list[dict]) -> str:
    if not is_broad_events_intent(question):
        return ""
    if not any(a["url"] == "https://tclexplorer.com/#events" for a in actions):
        return ""
    return {
        "en": "For events, the clearest view is the live TCLexplorer Events page. It shows the full schedule, your local times, and the current event status.",
        "ro": "Pentru evenimente, cel mai clar este să deschizi pagina live din TCLexplorer. Acolo vezi programul complet, orele în fusul tău local și statusul evenimentelor în timp real.",
        "tr": "Etkinlikler için en net yer TCLexplorer'daki canlı Events sayfasıdır.",
        "de": "Für Events ist die Live-Events-Seite in TCLexplorer am klarsten.",
        "es": "Para los eventos, la vista más clara es la página live de Events en TCLexplorer.",
        "fr": "Pour les événements, la vue la plus claire est la page Events live de TCLexplorer.",
        "it": "Per gli eventi, la vista più chiara è la pagina live Events di TCLexplorer.",
        "pl": "Dla wydarzeń najczytelniejsza jest strona live Events w TCLexplorer.",
        "pt": "Para eventos, a visualização mais clara é a página live Events no TCLexplorer.",
    }.get(language, "")


def guided_token_response(question: str, language: str) -> str:
    if not is_buy_token_intent(question):
        return ""
    return {
        "en": "TCL can be bought on xExchange (MultiversX) using EGLD or USDC — xExchange is the recommended option. In the xPortal app, tap the globe icon at the bottom right to open xExchange and swap for TCL.",
        "ro": "TCL se poate cumpăra pe xExchange (MultiversX) cu EGLD sau USDC — xExchange este varianta recomandată. În aplicația xPortal, apasă iconița glob din dreapta jos pentru a deschide xExchange și a face swap pe TCL.",
        "tr": "TCL, xExchange (MultiversX) üzerinden EGLD veya USDC ile satın alınabilir.",
        "de": "TCL kann auf xExchange (MultiversX) mit EGLD oder USDC gekauft werden.",
        "es": "TCL se puede comprar en xExchange (MultiversX) usando EGLD o USDC.",
        "fr": "TCL peut être acheté sur xExchange (MultiversX) avec EGLD ou USDC.",
        "it": "TCL può essere acquistato su xExchange (MultiversX) usando EGLD o USDC.",
        "pl": "TCL można kupić na xExchange (MultiversX) za EGLD lub USDC.",
        "pt": "TCL pode ser comprado no xExchange (MultiversX) usando EGLD ou USDC.",
    }.get(language, "")


def guided_loot_response(question: str, language: str, drop_data: Optional[dict]) -> str:
    if not is_loot_contents_intent(question) or not drop_data:
        return ""
    item_id = detect_chest(question)
    if item_id is None:
        return ""

    item_map = {i["id"]: i["name"] for i in drop_data.get("itemTemplates", [])}
    lt_map   = {lt["id"]: lt for lt in drop_data.get("lootTables", [])}

    chest_name = item_map.get(item_id)
    lt_id      = config.DROP_JSON_MANUAL_LOOT.get(item_id)
    lt         = lt_map.get(lt_id) if lt_id else None

    if not chest_name or not lt:
        return ""

    sorted_items = sorted(lt.get("items", []), key=lambda x: x["chance"])
    prev = 0.0
    contents = []
    for it in sorted_items:
        rate = round((it["chance"] - prev) * 100) / 100
        prev = it["chance"]
        name = item_map.get(it["item"], f"item#{it['item']}")
        contents.append(f"{name} ({rate}%)")

    intro = {
        "en": f"{chest_name} can contain:",
        "ro": f"{chest_name} poate conține:",
        "tr": f"{chest_name} şunları içerebilir:",
        "de": f"{chest_name} kann enthalten:",
        "es": f"{chest_name} puede contener:",
        "fr": f"{chest_name} peut contenir :",
        "it": f"{chest_name} può contenere:",
        "pl": f"{chest_name} może zawierać:",
        "pt": f"{chest_name} pode conter:",
    }.get(language, f"{chest_name} can contain:")

    return f"{intro} {', '.join(contents)}."


def build_event_status_context(
    events_data: dict,
    client_time_iso: str,
    utc_offset_minutes: int,
) -> str:
    if not events_data or not client_time_iso:
        return ""
    try:
        now = datetime.fromisoformat(client_time_iso.replace("Z", "+00:00"))
        now = now.astimezone(timezone.utc).replace(tzinfo=None)

        offset = int(utc_offset_minutes or 0)
        local_now = now + timedelta(minutes=offset)

        today_idx = (now.weekday() + 1) % 7  # Mon=0 in Python → Mon=0 in WEEK_DAYS

        sign = "+" if offset >= 0 else "-"
        abs_off = abs(offset)
        offset_str = f"UTC{sign}{abs_off // 60}" + (f":{abs_off % 60:02d}" if abs_off % 60 else "")
        local_time_str = f"{WEEK_DAYS[today_idx]} {local_now.strftime('%H:%M')} {offset_str}"

        lines = [f"Player current local time: {local_time_str}"]
        all_lines = []

        for d in range(7):
            day_idx = (today_idx + d) % 7
            day_key = WEEK_DAYS[day_idx]
            for ev in events_data.get(day_key, []):
                sh, sm = map(int, ev["start"].split(":"))
                eh, em = map(int, ev["end"].split(":"))

                start_utc = datetime(now.year, now.month, now.day, sh, sm) + timedelta(days=d)
                end_utc   = datetime(now.year, now.month, now.day, eh, em) + timedelta(days=d)

                local_start = start_utc + timedelta(minutes=offset)
                local_end   = end_utc   + timedelta(minutes=offset)
                ls_str = local_start.strftime("%H:%M")
                le_str = local_end.strftime("%H:%M")

                if now < start_utc:
                    mins = int((start_utc - now).total_seconds() // 60)
                    h, m = divmod(mins, 60)
                    if d == 0:
                        status = f"upcoming today in {f'{h}h ' if h else ''}{f'{m}m' if m else ''}".strip()
                    else:
                        status = f"next on {day_key} in {d} day{'s' if d > 1 else ''}"
                elif now < end_utc:
                    m_left = int((end_utc - now).total_seconds() // 60)
                    status = f"ACTIVE NOW — ends in {m_left} min"
                else:
                    continue

                all_lines.append(f"{ev['name']}: {'today' if d == 0 else day_key} local {ls_str}-{le_str} [{status}]")

        if all_lines:
            lines.append("Event schedule:")
            lines.extend(all_lines)
        return "\n".join(lines)
    except Exception:
        return ""


# ──────────────────────────── live data cache ────────────────────────────
import asyncio
import time

_drop_cache: tuple[Optional[dict], float] = (None, 0.0)
_events_cache: tuple[Optional[dict], float] = (None, 0.0)
_CACHE_TTL = 30 * 60


async def fetch_drop_data() -> Optional[dict]:
    global _drop_cache
    data, ts = _drop_cache
    if data and time.time() - ts < _CACHE_TTL:
        return data
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            resp = await http.get("https://tclexplorer.com/data/drop.json")
            resp.raise_for_status()
            data = resp.json()
            _drop_cache = (data, time.time())
            return data
    except Exception:
        return _drop_cache[0]


async def fetch_events_data() -> Optional[dict]:
    global _events_cache
    data, ts = _events_cache
    if data and time.time() - ts < _CACHE_TTL:
        return data
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            resp = await http.get("https://tclexplorer.com/weekly_events.json")
            resp.raise_for_status()
            data = resp.json()
            _events_cache = (data, time.time())
            return data
    except Exception:
        return _events_cache[0]


def needs_event_context(question: str) -> bool:
    return bool(re.search(
        r"\b(moonlight|clam|crystal|treasure|cufar|forge|experience|fishing|"
        r"crystals.frenzy|cand|când|azi|astazi|acum|now|today|active|activ|"
        r"urmeaza|urmează|next)\b",
        question, re.I
    ) or is_events_intent(question))
