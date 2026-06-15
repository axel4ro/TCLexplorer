import aiohttp
import asyncio
import base64
import time
import json
import os
import sys
import logging

logging.basicConfig(level=logging.WARNING)

# === CONFIG ===
TCL_MAIN_SC = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk"
MULTIVERSX_API = "https://api.multiversx.com"
CONTRACT_FUNCTIONS = [
    "claimRewards", "claimLendingRewards", "claimInfinityRewards",
    "addDaysAutoClaim", "setReinvestInfinity",
    "addInfinityStaking", "loanNft", "equipNft", "addTcl"
]
AFTER_TIMING = 1721865600       # 25 Jul 2024 00:00:00 UTC
PAGE_SIZE = 1000
WINDOW_DAYS = 7                 # ferestre pentru scanul initial
CACHE_FILE = "/opt/tcl-api/staking_cache.json"
LEADERBOARD_TMP = "/opt/tcl-api/leaderboard.json.tmp"
LEADERBOARD_DST = "/opt/tcl-api/leaderboard.json"
LOG_FILE = "/opt/tcl-api/logs/staking-indexer.log"
LEADERBOARD_BATCH = 25
LEADERBOARD_SLEEP = 2.0
# Rewards mai vechi de MAX_REWARD_AGE_SEC sunt re-interogate chiar daca nu s-a schimbat nimic
MAX_REWARD_AGE_SEC = 3600       # 1 ora

# === BECH32 UTILS ===
def bech32_polymod(values):
    G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = ((chk & 0x1ffffff) << 5) ^ v
        for i in range(5):
            chk ^= G[i] if ((b >> i) & 1) else 0
    return chk

def bech32_hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]

def bech32_verify_checksum(hrp, data):
    return bech32_polymod(bech32_hrp_expand(hrp) + data) == 1

def bech32_decode(bech):
    if any(ord(x) < 33 or ord(x) > 126 for x in bech):
        return None, None
    bech = bech.lower()
    pos = bech.rfind("1")
    if pos < 1 or pos + 7 > len(bech) or len(bech) > 90:
        return None, None
    hrp = bech[:pos]
    data = []
    for x in bech[pos+1:]:
        d = "qpzry9x8gf2tvdw0s3jn54khce6mua7l".find(x)
        if d == -1:
            return None, None
        data.append(d)
    if not bech32_verify_checksum(hrp, data):
        return None, None
    return hrp, data[:-6]

def bech32_convertbits(data, frombits, tobits, pad=True):
    acc, bits, ret = 0, 0, []
    maxv = (1 << tobits) - 1
    for value in data:
        if value < 0 or (value >> frombits):
            return None
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad:
        if bits:
            ret.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        return None
    return ret

def bech32_encode(hrp, data):
    CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    def create_checksum(hrp, data):
        values = bech32_hrp_expand(hrp) + data
        poly = bech32_polymod(values + [0]*6) ^ 1
        return [(poly >> 5*(5-i)) & 31 for i in range(6)]
    combined = data + create_checksum(hrp, data)
    return hrp + "1" + "".join([CHARSET[d] for d in combined])

def hex_to_bech32(hex_addr):
    return bech32_encode("erd", bech32_convertbits(list(bytes.fromhex(hex_addr)), 8, 5))

def bech32_to_hex(address):
    hrp, data = bech32_decode(address)
    if data is None:
        return None
    decoded = bech32_convertbits(data, 5, 8, False)
    if not decoded:
        return None
    return bytes(decoded).hex()

def decode_base64_to_bech32(encoded_data):
    try:
        decoded = base64.b64decode(encoded_data).decode("utf-8")
        hex_address = decoded.split("@")[1]
        return hex_to_bech32(hex_address)
    except:
        return None


# === PROGRESS LOGGER ===
class Progress:
    def __init__(self):
        self.start_time = time.time()
        self.scanned = 0
        self.new_addrs = 0
        self.duplicates = 0

    def log(self, msg):
        ts = time.strftime("%H:%M:%S")
        line = f"[{ts}] {msg}"
        print(line, flush=True)
        try:
            os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
            with open(LOG_FILE, "a") as f:
                f.write(line + "\n")
        except:
            pass


# === CACHE ===
def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE) as f:
                data = json.load(f)
            if "last_sync" not in data:
                data["last_sync"] = AFTER_TIMING
            if "addresses" not in data:
                data["addresses"] = []
            if "rewards" not in data:
                data["rewards"] = {}
            return data
        except Exception as e:
            print(f"[WARN] Cache corupt: {e}. Resetez.")
    return {
        "last_sync": AFTER_TIMING,
        "addresses": [],
        "rewards": {},      # addr -> {nft, loan, infinity, total, updated_at}
        "total_indexed": 0,
        "last_updated": None
    }

def save_cache(cache):
    tmp = CACHE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f)
    os.replace(tmp, CACHE_FILE)


# === FAZA 1: EXTRAGERE ADRESE NOI (incremental, time-windows) ===
async def fetch_new_addresses(cache, prog):
    known = set(cache["addresses"])
    new_found = set()
    last_sync = cache["last_sync"]
    now = int(time.time())

    # Prima rulare (cache gol): scanam tot de la AFTER_TIMING cu ferestre de 7 zile
    # Rulari ulterioare: scanam doar de la last_sync (ultimele minute)
    window_sec = WINDOW_DAYS * 86400
    windows = []
    t = last_sync
    while t < now:
        windows.append((t, min(t + window_sec, now)))
        t += window_sec

    is_initial = (last_sync == AFTER_TIMING)
    prog.log(
        f"[STAKING] {'INITIAL FULL SCAN' if is_initial else 'Incremental sync'} | "
        f"last_sync={time.strftime('%Y-%m-%d %H:%M', time.gmtime(last_sync))} | "
        f"windows={len(windows)} | known={len(known)}"
    )

    changed_addresses = set()  # adrese care au facut tranzactii in aceasta perioada

    async with aiohttp.ClientSession() as session:
        for fn in CONTRACT_FUNCTIONS:
            prog.log(f"[STAKING] --- {fn} ---")
            fn_new = 0

            for w_idx, (w_start, w_end) in enumerate(windows):
                await asyncio.sleep(0.15)
                offset = 0

                while True:
                    url = (
                        f"{MULTIVERSX_API}/transactions"
                        f"?from={offset}&size={PAGE_SIZE}"
                        f"&receiver={TCL_MAIN_SC}"
                        f"&status=success&function={fn}"
                        f"&after={w_start}&before={w_end}"
                    )
                    data = None
                    resp_status = 0
                    retry = 0
                    while retry < 8:
                        try:
                            async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                                resp_status = resp.status
                                if resp.status == 429:
                                    wait = min(5 * (2 ** retry), 120)
                                    prog.log(f"  429 — wait {wait}s (retry {retry+1})")
                                    await asyncio.sleep(wait)
                                    retry += 1
                                    continue
                                if resp.status == 400:
                                    prog.log(f"  400 offset={offset} — skip window")
                                    break
                                if resp.status != 200:
                                    prog.log(f"  HTTP {resp.status} — skip")
                                    break
                                data = await resp.json()
                                break
                        except asyncio.TimeoutError:
                            wait = min(5 * (2 ** retry), 60)
                            prog.log(f"  Timeout — retry {retry+1} in {wait}s")
                            await asyncio.sleep(wait)
                            retry += 1
                        except Exception as e:
                            prog.log(f"  Eroare: {e}")
                            break

                    if data is None or resp_status == 400:
                        break

                    for tx in data:
                        prog.scanned += 1
                        if fn in ("claimRewards", "claimLendingRewards", "claimInfinityRewards"):
                            addr = decode_base64_to_bech32(tx.get("data", ""))
                        else:
                            addr = tx.get("sender")
                        if addr:
                            changed_addresses.add(addr)
                            if addr not in known and addr not in new_found:
                                new_found.add(addr)
                                prog.new_addrs += 1
                                fn_new += 1
                            else:
                                prog.duplicates += 1

                    elapsed = time.time() - prog.start_time
                    speed = prog.scanned / elapsed if elapsed > 0 else 0
                    w_str = time.strftime("%Y-%m-%d", time.gmtime(w_start))
                    print(
                        f"[STAKING INDEXER] Batch {offset//PAGE_SIZE+1}"
                        f" w={w_idx+1}/{len(windows)} {w_str}"
                        f" | fn={fn[:12]}"
                        f" | scanned={prog.scanned:,}"
                        f" | new={prog.new_addrs:,}"
                        f" | dup={prog.duplicates:,}"
                        f" | speed={speed:.0f} tx/s",
                        flush=True
                    )

                    if len(data) < PAGE_SIZE:
                        break
                    offset += PAGE_SIZE

            prog.log(f"[STAKING] {fn}: +{fn_new} adrese noi")
            # salvare intermediara dupa fiecare functie
            cache["addresses"] = list(known | new_found)
            cache["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            save_cache(cache)

    all_addresses = list(known | new_found)
    cache["addresses"] = all_addresses
    cache["last_sync"] = now
    cache["last_sync_readable"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    cache["total_indexed"] = cache.get("total_indexed", 0) + prog.scanned
    cache["last_updated"] = cache["last_sync_readable"]
    save_cache(cache)

    prog.log(
        f"[STAKING] Cache salvat: {len(all_addresses)} adrese totale"
        f" | +{len(new_found)} noi"
        f" | {len(changed_addresses)} au tranzactii recente"
    )
    return all_addresses, changed_addresses


# === FAZA 2: FETCH REWARDS ===
async def fetch_rewards_single(session, addr):
    hex_arg = bech32_to_hex(addr)
    if not hex_arg:
        return None, None
    payload = {
        "scAddress": TCL_MAIN_SC,
        "funcName": "getRewardsData",
        "caller": addr,
        "value": "0",
        "args": [hex_arg]
    }
    for attempt in range(5):
        try:
            async with session.post(
                f"{MULTIVERSX_API}/query",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 429:
                    await asyncio.sleep(10 * (attempt + 1))
                    continue
                if resp.status != 201:
                    return None, None
                data = await resp.json()
                if "returnData" not in data or not data["returnData"]:
                    return None, None
                decoded = base64.b64decode(data["returnData"][0]).decode("utf-8")
                parts = decoded.split(" ")
                nft_stake = int(parts[4]) if len(parts) > 4 else 0
                loan_raw = int(parts[5]) if len(parts) > 5 else 0
                infinity_stake = int(parts[17]) if len(parts) > 17 else 0
                loan_stake = int(loan_raw * 1.25)
                total = nft_stake + loan_stake + infinity_stake
                return addr, {"nft": nft_stake, "loan": loan_stake, "infinity": infinity_stake, "total": total}
        except:
            await asyncio.sleep(2)
    return None, None


async def generate_leaderboard(all_addresses, changed_addresses, cache, prog):
    """
    Smart refresh:
    - Adresele cu tranzactii recente (changed_addresses) -> re-interogare live
    - Adresele cu rewards cached recente (< MAX_REWARD_AGE_SEC) -> folosim cache
    - Adresele cu rewards vechi (> MAX_REWARD_AGE_SEC) -> re-interogam
    """
    now = time.time()
    cached_rewards = cache.get("rewards", {})

    # Decide ce adrese trebuie re-interogate
    need_refresh = set()
    for addr in all_addresses:
        if addr in changed_addresses:
            need_refresh.add(addr)
            continue
        cached = cached_rewards.get(addr)
        if not cached:
            need_refresh.add(addr)
            continue
        age = now - cached.get("updated_at", 0)
        if age > MAX_REWARD_AGE_SEC:
            need_refresh.add(addr)

    stale_count = len([a for a in all_addresses if a not in changed_addresses
                        and cached_rewards.get(a)
                        and now - cached_rewards[a].get("updated_at", 0) > MAX_REWARD_AGE_SEC])

    prog.log(
        f"[LEADERBOARD] {len(all_addresses)} adrese totale"
        f" | {len(changed_addresses)} cu tranzactii recente"
        f" | {stale_count} cu rewards expirate"
        f" | {len(need_refresh)} de re-interogat"
        f" | {len(all_addresses) - len(need_refresh)} din cache"
    )

    refresh_list = list(need_refresh)
    lb_start = time.time()

    async with aiohttp.ClientSession() as session:
        for i in range(0, len(refresh_list), LEADERBOARD_BATCH):
            batch = refresh_list[i:i+LEADERBOARD_BATCH]
            tasks = [fetch_rewards_single(session, addr) for addr in batch]
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            for resp in responses:
                if isinstance(resp, Exception):
                    continue
                addr, data = resp
                if addr is not None:
                    cached_rewards[addr] = {
                        **(data or {"nft": 0, "loan": 0, "infinity": 0, "total": 0}),
                        "updated_at": now
                    }
                elif addr is None and resp[0] is not None:
                    # addr gasit dar total=0: keep in cache cu total=0
                    pass

            done = min(i + LEADERBOARD_BATCH, len(refresh_list))
            elapsed = time.time() - lb_start
            speed = done / elapsed if elapsed > 0 else 0
            eta = (len(refresh_list) - done) / speed if speed > 0 else 0
            eta_str = time.strftime("%H:%M:%S", time.gmtime(eta))
            prog.log(
                f"[LEADERBOARD] {done}/{len(refresh_list)} refreshed"
                f" | speed={speed:.1f} addr/s | ETA={eta_str}"
            )
            if i + LEADERBOARD_BATCH < len(refresh_list):
                await asyncio.sleep(LEADERBOARD_SLEEP)

    # Actualizam cache cu rewards noi
    cache["rewards"] = cached_rewards
    save_cache(cache)

    # Construim leaderboard din cache (combinat)
    leaderboard_raw = {}
    for addr in all_addresses:
        r = cached_rewards.get(addr)
        if r and r.get("total", 0) > 0:
            leaderboard_raw[addr] = r

    sorted_results = sorted(leaderboard_raw.items(), key=lambda x: x[1]["total"], reverse=True)
    leaderboard = {}
    for rank, (addr, data) in enumerate(sorted_results, 1):
        leaderboard[addr] = {
            "rank": rank,
            "nft": data["nft"],
            "loan": data["loan"],
            "infinity": data["infinity"],
            "total": data["total"]
        }
    return leaderboard


# === MAIN ===
async def main():
    prog = Progress()
    prog.log("=" * 60)
    prog.log("[STAKING INDEXER] Pornire")
    prog.log("=" * 60)

    cache = load_cache()
    last_readable = cache.get("last_sync_readable",
                               time.strftime("%Y-%m-%d", time.gmtime(cache["last_sync"])))
    prog.log(
        f"[CACHE] last_sync={last_readable}"
        f" | adrese={len(cache['addresses'])}"
        f" | rewards_cached={len(cache.get('rewards', {}))}"
    )

    # Faza 1: descopera adrese noi + afla ce s-a schimbat
    all_addresses, changed_addresses = await fetch_new_addresses(cache, prog)
    prog.log(f"[STAKING] Total adrese: {len(all_addresses)}")

    if not all_addresses:
        prog.log("[STAKING] Nicio adresa. Exit.")
        return

    # Faza 2: genereaza leaderboard (smart: doar changed + expired din cache)
    leaderboard = await generate_leaderboard(all_addresses, changed_addresses, cache, prog)

    # Scrie leaderboard.json atomic
    with open(LEADERBOARD_TMP, "w") as f:
        json.dump(leaderboard, f)
    os.replace(LEADERBOARD_TMP, LEADERBOARD_DST)

    elapsed = time.time() - prog.start_time
    prog.log("=" * 60)
    prog.log(f"[DONE] Leaderboard: {len(leaderboard)} walleturi active in {elapsed:.0f}s")
    prog.log(f"[DONE] Scanned={prog.scanned:,} | New={prog.new_addrs:,} | Dup={prog.duplicates:,}")
    prog.log("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
