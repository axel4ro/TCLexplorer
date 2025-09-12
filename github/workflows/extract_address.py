#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
from datetime import datetime

# Dummy leaderboard data (exemplu)
leaderboard = {
    "erd1exampleaddress1": {
        "rank": 1,
        "nft": 1000000000000000000000,
        "loan": 0,
        "infinity": 5000000000000000000000,
        "total": 6000000000000000000000
    },
    "erd1exampleaddress2": {
        "rank": 2,
        "nft": 0,
        "loan": 2000000000000000000000,
        "infinity": 1000000000000000000000,
        "total": 3000000000000000000000
    }
}

# Scrie leaderboard.json
with open("leaderboard.json", "w", encoding="utf-8") as f:
    json.dump(leaderboard, f, indent=2)

print(f"✅ leaderboard.json updated at {datetime.utcnow().isoformat()} UTC")
