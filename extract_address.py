#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, base64, requests
from datetime import datetime

SC_ADDRESS = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk"
API_URL = "https://api.multiversx.com/vm-values/query"

# Adrese reale de stakeri (adaugă câte vrei)
ADDRESSES = [
    "erd1tktmr7l8z033aulcrd558zyg74jk72nt40vjzq9xss7ka3dk4j0sfa58n8",
    "erd1uqvfhreupzgjh7ug630pwfxecg50kdv9umfcwq6d5whpad2hheussk9exc",
]

def bech32_to_hex(addr: str) -> str:
    import bech32
    hrp, data = bech32.bech32_decode(addr)
    decoded = bech32.convertbits(data, 5, 8, False)
    return "0x" + "".join(f"{b:02x}" for b in decoded)

def get_rewards(addr: str):
    try:
        hex_addr = bech32_to_hex(addr)
        payload = {
            "scAddress": SC_ADDRESS,
            "funcName": "getRewardsData",
            "args": [hex_addr]
        }
        resp = requests.post(API_URL, json=payload).json()
        if "returnData" not in resp or not resp["returnData"]:
            return (0, 0, 0, 0)

        decoded = base64.b64decode(resp["returnData"][0]).decode()
        parts = decoded.split(" ")

        nft = int(parts[4]) if len(parts) > 4 else 0
        loan = int(parts[5]) if len(parts) > 5 else 0
        infinity = int(parts[17]) if len(parts) > 17 else 0
        total = nft + loan + infinity
        return (nft, loan, infinity, total)
    except Exception as e:
        print(f"⚠️ Error {addr}: {e}")
        return (0, 0, 0, 0)

def main():
    leaderboard = {}
    for i, addr in enumerate(ADDRESSES, start=1):
        nft, loan, infinity, total = get_rewards(addr)
        leaderboard[addr] = {
            "rank": i,
            "nft": nft,
            "loan": loan,
            "infinity": infinity,
            "total": total
        }

    with open("leaderboard.json", "w", encoding="utf-8") as f:
        json.dump(leaderboard, f, indent=2)

    print(f"✅ leaderboard.json updated at {datetime.utcnow().isoformat()} UTC")

if __name__ == "__main__":
    main()
