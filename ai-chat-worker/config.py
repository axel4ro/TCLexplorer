import os

OLLAMA_URL          = os.getenv("OLLAMA_URL",          "http://localhost:11434")
OLLAMA_MODEL        = os.getenv("OLLAMA_MODEL",        "qwen2.5:14b")
OLLAMA_EMBED_MODEL  = os.getenv("OLLAMA_EMBED_MODEL",  "nomic-embed-text")

QDRANT_URL          = os.getenv("QDRANT_URL",          "http://localhost:6333")
QDRANT_COLLECTION   = os.getenv("QDRANT_COLLECTION",   "tcl_knowledge")
VECTOR_SIZE         = 768  # nomic-embed-text output dimension

ALLOWED_ORIGINS     = os.getenv(
    "ALLOWED_ORIGINS",
    "https://tclexplorer.com,https://axel4ro.github.io,http://localhost"
).split(",")

SYNC_SECRET         = os.getenv("SYNC_SECRET", "")

MAX_QUESTION_CHARS  = 1000
MAX_CONTEXT_CHARS   = 1200
RAG_MATCH_COUNT     = int(os.getenv("RAG_MATCH_COUNT", "6"))

CHUNK_SIZE          = int(os.getenv("CHUNK_SIZE",    "1400"))
CHUNK_OVERLAP       = int(os.getenv("CHUNK_OVERLAP", "220"))
MAX_CHUNKS          = int(os.getenv("MAX_CHUNKS",    "500"))

TCL_EXPLORER_BASE = "https://tclexplorer.com/"
TCL_EXPLORER_PATHS = [
    "",
    "analytics.html", "CanIrunIt.html", "connect_xportal.html",
    "earn.html", "flow.html", "Game_Requirements.html",
    "Items_Upgrade_Simulator.html", "Item_Upgrade_Requirements.html",
    "loot.html", "NFTs.html", "signal.html",
    "TCL_apr_rewards_calculator.html", "TCL_trades.html",
    "TCL_transaction_simulator.html", "Technicals.html", "volume.html",
    "wiki.html", "weekly_events.json", "leaderboard.json",
    "data/drop.json", "data/items_data.json", "data/tcl-analytics.json",
    "lang/analytics.bundle.js", "lang/apr-rewards.bundle.js",
    "lang/blacksmith.bundle.js", "lang/can-i-run-it.bundle.js",
    "lang/claim-flow.bundle.js", "lang/common.bundle.js",
    "lang/dashboard.bundle.js", "lang/earn.bundle.js",
    "lang/events.bundle.js", "lang/exp-table.bundle.js",
    "lang/game-requirements.bundle.js", "lang/item-upgrade.bundle.js",
    "lang/loot.bundle.js", "lang/nfts.bundle.js",
    "lang/page-common.bundle.js", "lang/signal.bundle.js",
    "lang/tcl-trades.bundle.js", "lang/technicals.bundle.js",
    "lang/token.bundle.js", "lang/transaction-simulator.bundle.js",
    "lang/volume.bundle.js", "lang/web3.bundle.js",
    "lang/wiki-ui.bundle.js", "lang/wiki.bundle.js",
]

EXTRA_SOURCES = [
    "https://www.thecursedland.com/",
    "https://whitepaper.thecursedland.com/",
]

DROP_JSON_MANUAL_LOOT = {
    1517: 228,
    1211: 51,
    1213: 53,
    1422: 168,
    1212: 52,
    1509: 262,
    1773: 295,
    1775: 326,
}

DROP_JSON_EXCLUDED_MOBS = {99, 100, 121, 117, 118, 120, 115, 116, 113, 114, 119, 122}
