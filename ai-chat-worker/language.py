import re

SUPPORTED_LANGUAGES = {
    "en": {"name": "English",    "missing": "I don't have that information in the current knowledge base."},
    "ro": {"name": "Romanian",   "missing": "Nu am această informație în baza de cunoștințe actuală."},
    "tr": {"name": "Turkish",    "missing": "Şu anda sahip olduğum bilgilerde bu bilgi yok."},
    "de": {"name": "German",     "missing": "Diese Information habe ich in der aktuellen Wissensbasis nicht."},
    "es": {"name": "Spanish",    "missing": "No tengo esa información en la base de conocimiento actual."},
    "fr": {"name": "French",     "missing": "Je n'ai pas cette information dans la base de connaissances actuelle."},
    "it": {"name": "Italian",    "missing": "Non ho questa informazione nella base di conoscenza attuale."},
    "pl": {"name": "Polish",     "missing": "Nie mam tej informacji w aktualnej bazie wiedzy."},
    "pt": {"name": "Portuguese", "missing": "Não tenho essa informação na base de conhecimento atual."},
}

_LANGUAGE_HINTS = [
    ("ro", re.compile(r"[ăâîșşțţ]", re.I),
     ["cum", "care", "unde", "cat", "cati", "cate", "este", "sunt", "pentru", "despre", "joc", "recompense", "vreau", "pot"]),
    ("tr", re.compile(r"[çğıöşü]", re.I),
     ["nasil", "nedir", "oyun", "etkinlik", "ganimet", "yukselt", "hakkinda"]),
    ("de", re.compile(r"[äöüß]", re.I),
     ["wie", "was", "wo", "spiel", "ereignis", "belohnung"]),
    ("es", re.compile(r"[áéíóúñ¿¡]", re.I),
     ["como", "que", "donde", "juego", "eventos", "recompensas"]),
    ("fr", re.compile(r"[àâçéèêëîïôùûüÿœ]", re.I),
     ["comment", "quoi", "jeu", "evenements", "recompenses"]),
    ("it", re.compile(r"[àèéìòù]", re.I),
     ["come", "cosa", "dove", "gioco", "eventi", "ricompense"]),
    ("pl", re.compile(r"[ąćęłńóśźż]", re.I),
     ["jak", "gdzie", "gra", "wydarzenia", "nagrody"]),
    ("pt", re.compile(r"[ãõáâàçéêíóôú]", re.I),
     ["onde", "jogo", "eventos", "recompensas"]),
]


def normalize_language(value: str) -> str:
    code = str(value or "en").lower().split("-")[0].split("_")[0]
    return code if code in SUPPORTED_LANGUAGES else "en"


def detect_language(question: str) -> str:
    text = question.lower()
    for lang, char_pattern, words in _LANGUAGE_HINTS:
        if char_pattern.search(text):
            return lang
        if any(re.search(rf"\b{w}\b", text) for w in words):
            return lang
    return "en"


def language_name(lang: str) -> str:
    return SUPPORTED_LANGUAGES[normalize_language(lang)]["name"]


def missing_answer(lang: str) -> str:
    return SUPPORTED_LANGUAGES[normalize_language(lang)]["missing"]


def resolve_question_with_history(question: str, history: list) -> str:
    """Expand short/pronoun-heavy follow-ups using the last user message."""
    if not history:
        return question
    words = question.strip().split()
    has_pronoun = bool(re.search(
        r"\b(el|ea|it|acesta|aceasta|asta|ăsta|ala|ăla|acela|aceea|lui|ei|this|that|they|them|its)\b",
        question, re.I
    ))
    if not has_pronoun and len(words) > 4:
        return question
    last_user = next((h["content"] for h in reversed(history) if h.get("role") == "user"), None)
    if last_user:
        return f"{last_user} {question}".strip()
    return question
