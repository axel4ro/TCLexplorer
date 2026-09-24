(function () {
  "use strict";

  const SC = window.LanderWallet.TCL_MAIN_SC;

  // getRewardsData(hexAddress) returns a single space-separated string with
  // ~30 fields, no published ABI/labels. Fields confirmed by direct
  // comparison against real Lander screenshots for this same wallet:
  //   [2]  APR (%)
  //   [4]  NFT-staked amount (wei)
  //   [5]  Loan-staked amount, raw/reward-eligible (wei) — the game's own
  //        "Loaned" figure is this * 1.25 (20% of loan yield is redirected
  //        to in-game borrowers; confirmed exactly against a live screenshot:
  //        5,165,133 * 0.8 = 4,132,106.4)
  //   [10] Pending/claimable lending reward (wei) — matched "Next Claim:
  //        5,579 TCL" on the Loaned tab (this field read 5,574.9 a few
  //        minutes later, consistent with continued accrual)
  //   [17] Infinity-staked amount (wei)
  //   [18] Daily infinity reward (wei) — already boost-adjusted by the
  //        contract; matched "Daily reward: 4,041 TCL" almost exactly
  //   [20] Cumulative infinity rewards earned (wei) — exact match to
  //        "Earned: 1,714,625 TCL"
  //   [6]  Current epoch as the contract sees it
  //   [23] Epoch until which Auto Claim is paid for (0 = no Auto Claim). Days remaining =
  //        [23] - [6]; matched a real Lander screenshot (915 days at epoch 2175, expiry 3090) and
  //        checked on 5 wallets (0 for a wallet with no Auto Claim).
  // All other fields are unidentified; do not rely on them.
  const FIELD = { apr: 2, epoch: 6, nft: 4, loanRaw: 5, lendingPending: 10, infinityStake: 17, infinityDaily: 18, infinityEarned: 20, autoClaimEndEpoch: 23 };

  function decodeReturnData(b64) {
    return atob(b64);
  }

  function toTcl(str) {
    const n = Number(str);
    return Number.isFinite(n) ? n / 1e18 : 0;
  }

  async function queryRewardsData(address) {
    const hex = MultiversXAPI.bech32ToHex(address);
    const [ret] = await MultiversXAPI.queryContract(SC, "getRewardsData", [hex]);
    if (!ret) return null;
    return decodeReturnData(ret).split(" ");
  }

  // MultiversX represents an NFT's nonce as the shortest EVEN-length hex
  // string (odd-length gets a single leading zero) — verified against 7
  // real equipped items for a live wallet, e.g. decimal nonce 37 -> "25" ->
  // identifier "TCLSHIELD-7f316e-25", decimal 6 -> "06" -> "...-06".
  function nonceToHex(nonceDec) {
    let hex = Number(nonceDec).toString(16);
    if (hex.length % 2 !== 0) hex = "0" + hex;
    return hex;
  }

  // getEquippedNfts/getLoanedNfts both return one comma-separated blob:
  // "COLLECTION-hash NONCE STAKED_WEI FLAG [ipfsPath],..." per item, no
  // published ABI — fields confirmed against a live wallet's real
  // getEquippedNfts result (7 items, one per equipment slot plus a Boost
  // item with no staked value/ipfs path).
  function parseNftBlob(str) {
    if (!str) return [];
    return str
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const [collectionHash, nonceDec, stakedWei, flag] = entry.split(" ");
        if (!collectionHash || nonceDec === undefined) return null;
        return {
          identifier: `${collectionHash}-${nonceToHex(nonceDec)}`,
          collection: collectionHash,
          nonce: nonceDec,
          staked: toTcl(stakedWei || "0"),
          flag: Number(flag) || 0
        };
      })
      .filter(Boolean);
  }

  // getTclMax(collection, nonce) is the same real per-NFT SC view function
  // the main site's own NFT indexer (sync-nfts.js) already relies on for
  // the storage-capacity figure ("current/max TCL" on each equipment
  // card) — confirmed live: getTclCount matched the blob's own staked
  // figure exactly for a real equipped item, so the two sources agree.
  function asciiToHex(str) {
    let hex = "";
    for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(2, "0");
    return hex;
  }

  async function getTclValue(funcName, collection, nonceDec) {
    try {
      const nonceHex = Number(nonceDec).toString(16).padStart(16, "0");
      const [ret] = await MultiversXAPI.queryContract(SC, funcName, [asciiToHex(collection), nonceHex]);
      return toTcl(ret ? MultiversXAPI.base64BigInt(ret).toString() : "0");
    } catch (_) {
      return 0;
    }
  }
  const getTclMax = (collection, nonceDec) => getTclValue("getTclMax", collection, nonceDec);

  async function withTclMax(entries) {
    const maxes = await Promise.all(entries.map((e) => getTclMax(e.collection, e.nonce)));
    return entries.map((e, i) => ({ ...e, max: maxes[i] }));
  }

  async function getEquippedNftEntries(address) {
    try {
      const hex = MultiversXAPI.bech32ToHex(address);
      const [ret] = await MultiversXAPI.queryContract(SC, "getEquippedNfts", [hex]);
      return withTclMax(parseNftBlob(ret ? decodeReturnData(ret) : ""));
    } catch (err) {
      throw err;
    }
  }

  // The contract has NO view for a wallet's loaned NFTs (getLoanedNfts answers "function not
  // found" — an earlier version of this file mistook that for an empty list). The equip/loan
  // NFTs all sit in the contract, so the loaned set is rebuilt from the wallet's own history:
  // the LAST of loanNft / unloanNft / equipNft / unequipNft per NFT decides where it is, and it
  // must still be held by the contract. Verified on real wallets against the owner of each NFT.
  const LOAN_OPS = ["loanNft", "unloanNft", "equipNft", "unequipNft"];
  const LOAN_CACHE_KEY = "lander:loanedCache:v1";
  const LOAN_CACHE_MS = 10 * 60 * 1000;
  function readLoanCache(address) {
    try {
      const hit = JSON.parse(localStorage.getItem(LOAN_CACHE_KEY) || "{}")[address];
      return hit && Date.now() - hit.t < LOAN_CACHE_MS ? hit.v : null;
    } catch (_) { return null; }
  }
  function writeLoanCache(address, value) {
    try {
      const all = JSON.parse(localStorage.getItem(LOAN_CACHE_KEY) || "{}");
      all[address] = { t: Date.now(), v: value };
      const keys = Object.keys(all);
      if (keys.length > 10) delete all[keys[0]];
      localStorage.setItem(LOAN_CACHE_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  async function fetchOpHistory(address, funcName) {
    let out = [];
    for (let from = 0; out.length < 1000; from += 50) {
      const rows = await MultiversXAPI.getJSON(
        `${MultiversXAPI.API}/accounts/${address}/transactions?function=${funcName}&status=success&size=50&from=${from}&order=desc&fields=timestamp,function,action`,
        { ttl: 60000 }
      );
      if (!Array.isArray(rows)) break;
      out = out.concat(rows);
      if (rows.length < 50) break;
    }
    return out;
  }

  async function getLoanedNftEntries(address) {
    const cached = readLoanCache(address);
    if (cached) return cached;
    {
      const histories = await Promise.all(LOAN_OPS.map((fn) => fetchOpHistory(address, fn)));
      const ops = histories.flat().sort((a, b) => a.timestamp - b.timestamp);
      const last = {};
      for (const tx of ops) {
        for (const t of tx.action?.arguments?.transfers || []) {
          if (t.type === "FungibleESDT" || !t.identifier) continue;
          last[t.identifier] = tx.function;
        }
      }
      const candidates = Object.keys(last).filter((id) => last[id] === "loanNft");
      const held = [];
      for (let i = 0; i < candidates.length; i += 40) {
        const chunk = candidates.slice(i, i + 40);
        const rows = await MultiversXAPI.getJSON(
          `${MultiversXAPI.API}/nfts?identifiers=${chunk.join(",")}&withOwner=true&size=100&fields=identifier,owner`,
          { ttl: 30000 }
        );
        (rows || []).forEach((n) => { if (n.owner === SC) held.push(n.identifier); });
      }
      // An NFT can be sold/transferred after this wallet loaned it and then loaned again by its
      // new owner (seen on a real wallet: 23,287 TCL of difference vs the contract's Loaned
      // total was exactly one such item), so the latest loanNft on the NFT must be ours.
      const mine = [];
      for (const identifier of held) {
        const rows = await MultiversXAPI.getJSON(
          `${MultiversXAPI.API}/nfts/${identifier}/transactions?function=loanNft&status=success&size=1&order=desc&fields=sender`,
          { ttl: 60000 }
        ).catch(() => null);
        if (!rows || !rows[0] || rows[0].sender === address) mine.push(identifier);
      }
      const entries = await Promise.all(mine.map(async (identifier) => {
        const cut = identifier.lastIndexOf("-");
        const collection = identifier.slice(0, cut);
        const nonce = parseInt(identifier.slice(cut + 1), 16);
        const [staked, max] = await Promise.all([
          getTclValue("getTclCount", collection, nonce),
          getTclValue("getTclMax", collection, nonce)
        ]);
        return { identifier, collection, nonce: String(nonce), staked, max, flag: 0 };
      }));
      writeLoanCache(address, entries);
      return entries;
    }
  }

  async function getPriceUsd() {
    try {
      const t = await MultiversXAPI.getToken();
      return Number(t.price) || 0;
    } catch (_) {
      return 0;
    }
  }

  // Querying getRewardsData with the CONTRACT'S OWN address (instead of a
  // player's) is the convention the main TCLexplorer site already relies on
  // to read the GLOBAL aggregate totals (not a per-wallet position) —
  // parts[3] = total TCL staked across all players.
  // The equipped-boost NFT (+5%/+7%/+10%) isn't exposed by getRewardsData.
  // api.tclexplorer.com/api/leaderboard has the number too, but its CORS
  // policy only allows requests from https://tclexplorer.com — any other
  // origin (this local Dashboard included) gets silently blocked, which is
  // why the badge always read 0% here. The percentage is also encoded
  // directly on-chain in the wallet's own equipped TCLBOOST item's
  // metadata.description ("Holders receive a N% bonus...") — confirmed
  // against two real items (10% and 7%) — so read it straight from there
  // instead of depending on that cross-origin call.
  async function getBoostPct(address) {
    try {
      const equipped = await getEquippedNftEntries(address);
      const boostItem = equipped.find((e) => e.identifier.startsWith("TCLBOOST-"));
      if (!boostItem) return 0;
      const meta = await MultiversXAPI.getNFT(boostItem.identifier);
      const match = /(\d+)\s*%/.exec(meta?.metadata?.description || "");
      return match ? Number(match[1]) : 0;
    } catch (_) {
      return 0;
    }
  }

  // Whether the Claim button or the countdown pill shows depends on
  // whether this wallet already received its reward payout for the
  // current network epoch. Checking the wallet's OWN claimInfinityRewards/
  // claimLendingRewards transaction history isn't enough — the game also
  // pays rewards out via a batched "Auto Claim" bot
  // (erd18lsmq9rldm52syrgqzpwrjrvqlsxprgvp9v6ne5qtjymqgzgr8qs9ngtcl) that
  // calls claimRewards/claimBorrowingRewards on the SC on the wallet's
  // behalf; those transactions never name this wallet as sender/receiver
  // and never appear under /accounts/{wallet}/transactions at all.
  // Confirmed on real auto-claim transactions (2026-07-14): regardless of
  // which function actually triggered the payout, the SC always fans the
  // reward out as a plain ESDTTransfer FROM the contract itself to the
  // wallet, which the MultiversX API indexes under the wallet's own
  // /transfers endpoint — so checking the most recent inbound TCL transfer
  // from the SC catches self-claims and bot auto-claims uniformly, for
  // both Infinity and Lending.
  async function getLastRewardTransferMs(address) {
    try {
      const res = await fetch(
        `${MultiversXAPI.API}/accounts/${address}/transfers?sender=${SC}&token=${MultiversXAPI.TOKEN}&size=1&order=desc`
      );
      const transfers = await res.json();
      return Array.isArray(transfers) && transfers[0] ? Number(transfers[0].timestamp) * 1000 : 0;
    } catch (_) {
      return 0;
    }
  }

  async function getGlobalStats() {
    const [parts, price] = await Promise.all([queryRewardsData(SC), getPriceUsd()]);
    if (!parts) throw new Error("No global staking data returned.");
    const totalStaked = toTcl(parts[3]);
    return { totalStaked, totalStakedUSD: totalStaked * price, price };
  }

  async function getInfinityStakingLive(address) {
    const [parts, price, boostPct] = await Promise.all([queryRewardsData(address), getPriceUsd(), getBoostPct(address)]);
    if (!parts) throw new Error("No staking data returned for this wallet.");
    const stake = toTcl(parts[FIELD.infinityStake]);
    const daily = toTcl(parts[FIELD.infinityDaily]);
    const earned = toTcl(parts[FIELD.infinityEarned]);
    const apr = Number(parseFloat(parts[FIELD.apr]).toFixed(2)) || 0;
    const autoClaimDays = Math.max(0, (Number(parts[FIELD.autoClaimEndEpoch]) || 0) - (Number(parts[FIELD.epoch]) || 0));
    return {
      autoClaimDays,
      stake,
      stakeUSD: stake * price,
      apr,
      boostPct,
      daily,
      dailyUSD: daily * price,
      earned,
      earnedUSD: earned * price,
      price,
      source: "MultiversX getRewardsData · live"
    };
  }

  async function getLendingLive(address) {
    const [parts, price, boostPct] = await Promise.all([queryRewardsData(address), getPriceUsd(), getBoostPct(address)]);
    if (!parts) throw new Error("No staking data returned for this wallet.");
    const loanRaw = toTcl(parts[FIELD.loanRaw]);
    const loanDisplay = loanRaw * 1.25;
    const pending = toTcl(parts[FIELD.lendingPending]);
    return {
      loanRaw,
      loanDisplay,
      loanDisplayUSD: loanDisplay * price,
      boostPct,
      pending,
      pendingUSD: pending * price,
      price,
      source: "MultiversX getRewardsData · live"
    };
  }

  window.LanderLive = {
    FIELD,
    queryRewardsData,
    getInfinityStakingLive,
    getLendingLive,
    getGlobalStats,
    getBoostPct,
    getLastRewardTransferMs,
    getEquippedNftEntries,
    getLoanedNftEntries
  };
})();
