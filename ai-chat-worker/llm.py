import json
import re
from typing import AsyncIterator
import httpx
import config
from language import language_name

SYSTEM_TEMPLATE = """\
Ești Companion, asistentul oficial al jucătorilor The Cursed Land pe TCLexplorer.

Reguli stricte:
- Răspunzi ÎNTOTDEAUNA în {lang_name} cu gramatică corectă și naturală.
- Pentru română: folosește diacritice corecte (ă â î ș ț), forme verbale corecte, fraze naturale — evită traducerea mot-à-mot din engleză.
- Fii conversațional. La întrebări da/nu, începe cu "Da," sau "Nu,".
- Răspunde DOAR la ce s-a întrebat. Nu amesteca informații din mecanici diferite ale jocului.
- Dacă contextul RAG nu conține răspunsul, spune simplu că nu știi — nu specula.
- Nu inventa mecanici, statistici, procente sau date care nu se află în context.
- Doar text simplu, fără markdown, fără URL-uri brute. Răspunsuri concise (2-5 propoziții max).{event_note}
"""

EVENT_NOTE = "\n- IMPORTANT: Folosește STATUSUL LIVE AL EVENIMENTELOR pentru toate răspunsurile despre orar — acesta are prioritate față de orice alt context."


async def generate_stream(
    question: str,
    context: str,
    language: str,
    history: list[dict],
    event_context: str = "",
) -> AsyncIterator[str]:
    lang = language_name(language)
    system = SYSTEM_TEMPLATE.format(
        lang_name=lang,
        event_note=EVENT_NOTE if event_context else "",
    )

    parts = [f"Limba jucătorului: {language}"]
    if event_context:
        parts += [
            "",
            "*** STATUS LIVE EVENIMENTE — autoritar, folosește pentru orar ***",
            event_context,
            "*** Sfârșit status live. Contextul RAG de mai jos este pentru info generale ***",
        ]
    parts += ["", "Context RAG:", context, "", "Întrebarea jucătorului:", question]
    user_prompt = "\n".join(parts)

    messages = []
    for h in history[-4:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_prompt})

    payload = {
        "model": config.OLLAMA_MODEL,
        "messages": [{"role": "system", "content": system}] + messages,
        "stream": True,
        "options": {
            "temperature": 0.25,
            "num_predict": 350,
            "stop": ["<|im_end|>", "<|end|>", "</s>"],
        },
    }

    async with httpx.AsyncClient(timeout=120) as http:
        async with http.stream(
            "POST",
            f"{config.OLLAMA_URL}/api/chat",
            json=payload,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                token = data.get("message", {}).get("content", "")
                if token:
                    yield token
                if data.get("done"):
                    break


def clean_answer(text: str, language: str) -> str:
    from language import missing_answer
    text = re.sub(r"\*\*", "", text)
    text = re.sub(r"^\s*[-*]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return missing_answer(language)

    # Trim incomplete trailing fragment
    last_punct = max(text.rfind("."), text.rfind("!"), text.rfind("?"))
    tail = text[last_punct + 1:].strip() if last_punct >= 0 else text
    incomplete = re.search(
        r"\b(and|or|but|with|from|for|to|of|by|in|is|are|the|a|an|si|sau|cu|din|pentru|este|sunt|un|o)$",
        text, re.I
    )
    if last_punct > 30 and (len(tail) <= 36 or incomplete):
        text = text[:last_punct + 1].strip()

    if not re.search(r"[.!?]$", text):
        text += "."
    return text
