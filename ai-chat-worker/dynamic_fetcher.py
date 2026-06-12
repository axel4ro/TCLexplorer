"""
dynamic_fetcher.py — Fetches live TCL data every 5 minutes and saves to data/dynamic.json
Runs standalone (not imported by main.py). PM2 handles scheduling via cron_restart.

Data fetched:
  - TCL price (USD) from DexScreener
  - Staking APR, total staked, daily emission (MultiversX SC)
  - MarketCap, volume, liquidity from DexScreener
"""

import asyncio
import base64
import json
import os
import time
from pathlib import Path

import httpx

# ── Config ────────────────────────────────────────────────────────────────────

MVX_API        = "https://api.multiversx.com"
TCL_SC         = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk"
TCL_TOKEN      = "TCL-fe459d"
PAIR_ADDR      = "erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff"
DEX_URL        = f"https://api.dexscreener.com/latest/dex/pairs/multiversx/{PAIR_ADDR}"
OUTPUT_FILE    = Path(os.getenv("DYNAMIC_JSON_PATH", "/opt/tcl-companion/data/dynamic.json"))
REQUEST_TIMEOUT = 20

# ── Helpers ───────────────────────────────────────────────────────────────────

BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _bech32_decode(bech: str):
    bech = bech.lower()
    pos = bech.rfind("1")
    data = [BECH32_CHARSET.index(c) for c in bech[pos + 1:]]
    return data[:-6]


def _convert_bits(data, frombits, tobits, pad=False):
    acc, bits, ret, maxv = 0, 0, [], (1 << tobits) - 1
    for v in data:
        acc = ((acc << frombits) | v)
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    return ret


def bech32_to_hex(addr: str) -> str:
    d = _bech32_decode(addr)
    b = _convert_bits(d, 5, 8, pad=False)
    return "".join(f"{x:02x}" for x in b)


def safe_float(v, divisor=1) -> float | None:
    try:
        return float(v) / divisor
    except (TypeError, ValueError, ZeroDivisionError):
        return None


# ── Fetch functions ────────────────────────────────────────────────────────────

async def fetch_price(http: httpx.AsyncClient) -> dict:
    """Price + market data from DexScreener."""
    try:
        r = await http.get(DEX_URL, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        pairs = r.json().get("pairs") or []
        if not pairs:
            return {}
        p = pairs[0]
        return {
            "price_usd":        safe_float(p.get("priceUsd")),
            "price_native":     safe_float(p.get("priceNative")),
            "liquidity_usd":    safe_float((p.get("liquidity") or {}).get("usd")),
            "market_cap_usd":   safe_float(p.get("fdv")),
            "volume_24h_usd":   safe_float((p.get("volume") or {}).get("h24")),
            "price_change_24h": safe_float((p.get("priceChange") or {}).get("h24")),
        }
    except Exception as e:
        print(f"[DexScreener] Error: {e}")
        return {}


async def fetch_staking(http: httpx.AsyncClient) -> dict:
    """
    Staking APR, total staked, daily emission from MultiversX SC.
    Calls getRewardsData with the SC's own hex address to get global stats.

    Return data (base64 decoded, space-separated):
      [2]  = Staking APR (%)
      [3]  = total staked (raw, /1e18)
      [14] = daily emission (raw, /1e18)
    """
    hex_addr = bech32_to_hex(TCL_SC)
    payload = {
        "scAddress": TCL_SC,
        "funcName":  "getRewardsData",
        "args":      [hex_addr],
    }
    for attempt in range(4):
        try:
            r = await http.post(
                f"{MVX_API}/query",
                json=payload,
                timeout=REQUEST_TIMEOUT,
                headers={"Content-Type": "application/json"},
            )
            if r.status_code == 429:
                retry_after = int(r.headers.get("retry-after", 15))
                print(f"[MVX] Rate limited, waiting {retry_after}s …")
                await asyncio.sleep(retry_after + 2)
                continue
            r.raise_for_status()
            data = r.json()
            rd = data.get("returnData") or (data.get("data", {}) or {}).get("data", {}).get("returnData")
            if not rd or not rd[0]:
                print("[MVX] Empty returnData")
                return {}

            decoded = base64.b64decode(rd[0]).decode("utf-8")
            parts   = decoded.split(" ")
            n       = len(parts)

            staking_apr  = safe_float(parts[2] if n > 2  else None)
            staked_raw   = safe_float(parts[3] if n > 3  else None)
            emission_raw = safe_float(parts[14] if n > 14 else None)

            staked_tcl   = staked_raw   / 1e18 if staked_raw   else None
            emission_day = emission_raw / 1e18 if emission_raw else None

            return {
                "staking_apr":     round(staking_apr, 2) if staking_apr   else None,
                "staked_tcl":      round(staked_tcl,  2) if staked_tcl    else None,
                "daily_emission_tcl": round(emission_day, 2) if emission_day else None,
            }
        except Exception as e:
            print(f"[MVX] Attempt {attempt+1} error: {e}")
            await asyncio.sleep(5 * (attempt + 1))
    return {}


async def fetch_token_info(http: httpx.AsyncClient) -> dict:
    """Circulating supply, holders from MultiversX token API."""
    try:
        r = await http.get(f"{MVX_API}/tokens/{TCL_TOKEN}", timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        d = r.json()
        supply  = safe_float(d.get("circulatingSupply"), 1e18)
        holders = d.get("accounts")
        return {
            "circulating_supply": round(supply, 2) if supply else None,
            "holders":            int(holders) if holders else None,
        }
    except Exception as e:
        print(f"[MVX token] Error: {e}")
        return {}


# ── Main ──────────────────────────────────────────────────────────────────────

async def run_once():
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Load existing data as fallback
    existing: dict = {}
    if OUTPUT_FILE.exists():
        try:
            existing = json.loads(OUTPUT_FILE.read_text())
        except Exception:
            pass

    print(f"[Fetcher] Starting fetch at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")

    async with httpx.AsyncClient(
        headers={"User-Agent": "TCLExplorer-DynamicFetcher/1.0"},
        follow_redirects=True,
    ) as http:
        price_data, staking_data, token_data = await asyncio.gather(
            fetch_price(http),
            fetch_staking(http),
            fetch_token_info(http),
        )

    # Merge: prefer fresh non-null values, fall back to existing
    def merge(new: dict, keys: list) -> dict:
        result = {}
        for k in keys:
            v = new.get(k)
            result[k] = v if v is not None else existing.get(k)
        return result

    result = {
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **merge(price_data, ["price_usd", "price_native", "liquidity_usd",
                             "market_cap_usd", "volume_24h_usd", "price_change_24h"]),
        **merge(staking_data, ["staking_apr", "staked_tcl", "daily_emission_tcl"]),
        **merge(token_data, ["circulating_supply", "holders"]),
    }

    # Human-readable summary for the AI indexer
    parts = []
    if result.get("price_usd"):
        parts.append(f"Prețul TCL este {result['price_usd']} USD")
    if result.get("staking_apr"):
        parts.append(f"APR-ul de staking TCL este {result['staking_apr']}%")
    if result.get("staked_tcl"):
        parts.append(f"Total TCL staked: {result['staked_tcl']:,.0f} TCL")
    if result.get("daily_emission_tcl"):
        parts.append(f"Emisia zilnică: {result['daily_emission_tcl']:,.0f} TCL/zi")
    if result.get("circulating_supply"):
        parts.append(f"Supply circulant: {result['circulating_supply']:,.0f} TCL")
    if result.get("holders"):
        parts.append(f"Holderi TCL: {result['holders']:,}")
    if result.get("market_cap_usd"):
        parts.append(f"Market cap: ${result['market_cap_usd']:,.0f} USD")
    if result.get("volume_24h_usd"):
        parts.append(f"Volum 24h: ${result['volume_24h_usd']:,.0f} USD")
    if result.get("price_change_24h") is not None:
        parts.append(f"Variație preț 24h: {result['price_change_24h']}%")
    if result.get("liquidity_usd"):
        parts.append(f"Lichiditate pool: ${result['liquidity_usd']:,.0f} USD")

    result["summary_ro"] = ". ".join(parts) + "." if parts else ""

    OUTPUT_FILE.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"[Fetcher] Saved → {OUTPUT_FILE}")
    print(f"[Fetcher] Price: {result.get('price_usd')} USD | "
          f"Staking APR: {result.get('staking_apr')}% | "
          f"Staked: {result.get('staked_tcl')} TCL")


if __name__ == "__main__":
    asyncio.run(run_once())
