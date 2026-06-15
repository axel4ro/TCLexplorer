const SUBSCRIPTION_PREFIX = "subscription:";
const SENT_PREFIX = "sent:";
const STATS_KEY = "stats:subscriptions";
const STATS_HISTORY_PREFIX = "stats:history:";
const LAST_DISPATCH_KEY = "push:last-dispatch";
const CLAIM_REMINDER_PREFIX = "claim-reminder:";
const CLAIM_SENT_PREFIX = "claim-sent:";
const CLAIM_STATS_KEY = "claim:stats";
const CLAIM_LAST_DISPATCH_KEY = "claim:last-dispatch";
const CLAIM_DEFAULT_EARLY_DAYS = 7;
const CLAIM_SENT_TTL_SECONDS = 60 * 24 * 60 * 60;
const DEFAULT_REMINDER_MINUTES = 15;
const LEGACY_DEFAULT_REMINDER_MINUTES = 10;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_MS = 24 * 60 * 60 * 1000;
const SENT_TTL_SECONDS = 14 * 24 * 60 * 60;
const DEFAULT_EVENTS_URL = "https://tclexplorer.com/weekly_events.json";
const ANALYTICS_SNAPSHOT_KEY = "analytics:snapshot";
const ANALYTICS_REFRESH_LOCK_KEY = "analytics:refresh-lock";
const ANALYTICS_REFRESH_LOCK_TTL_SECONDS = 4 * 60;
const DEFAULT_ANALYTICS_REFRESH_INTERVAL_MINUTES = 15;
const ANALYTICS_ENDPOINTS = {
  coin: "https://api.cryptorank.io/v0/coins/the-cursed-land",
  quarterly: "https://api.cryptorank.io/v0/coins/the-cursed-land/quarterly-history",
  monthly: "https://api.cryptorank.io/v0/coins/the-cursed-land/monthly-history"
};
const VOLUME_SNAPSHOT_KEY = "volume:snapshot";
const VOLUME_REFRESH_LOCK_KEY = "volume:refresh-lock";
const VOLUME_REFRESH_LOCK_TTL_SECONDS = 4 * 60;
const DEFAULT_VOLUME_REFRESH_INTERVAL_MINUTES = 5;
const TECHNICALS_SNAPSHOT_KEY = "technicals:snapshot";
const TECHNICALS_REFRESH_LOCK_KEY = "technicals:refresh-lock";
const TECHNICALS_REFRESH_LOCK_TTL_SECONDS = 4 * 60;
const DEFAULT_TECHNICALS_REFRESH_INTERVAL_MINUTES = 5;
const MARKETPLACE_SC_ADDRESS = "erd1qqqqqqqqqqqqqpgqfs74tc3e6k9lx6s67chyxylyjvscppu7fqmsypuu25";
const MARKETPLACE_PAIR_ADDRESS = "erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff";
const MARKETPLACE_TOKEN = "TCL-fe459d";
const MARKETPLACE_MVX_API = "https://api.multiversx.com";
const PRICES_SNAPSHOT_KEY = "prices:snapshot";
const PRICES_GECKO_KEY = "prices:gecko";
const PRICES_CACHE_TTL_SECONDS = 30;
const PRICES_GECKO_TTL_SECONDS = 3600;
const PRICES_TCL_PAIR_URL = "https://api.dexscreener.com/latest/dex/pairs/multiversx/erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff";
const PRICES_EGLD_PAIR_URL = "https://api.dexscreener.com/latest/dex/pairs/multiversx/erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq";
const PRICES_TOKEN_URL = "https://api.multiversx.com/tokens/TCL-fe459d";
const PRICES_GECKO_URL = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=lander";
const PRICES_GECKO_FALLBACK = { ath: 0.010077, atl: 0.000372 };
const PNL_DEXSCREENER_CACHE_PREFIX = "pnl:dexscreener:";
const PNL_DEXSCREENER_CACHE_TTL_SECONDS = 10 * 60;
const PNL_DEXSCREENER_CONFIG = {
  chainId: "multiversx",
  ammId: "xexchange",
  pairAddress: "erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff",
  quoteTokenAddress: "USDC-c76f1f",
  logsBaseUrl: "https://io.dexscreener.com/dex/log/amm/v4",
  pagePauseMs: 300,
  maxPages: 80,
  maxAttempts: 3
};
const PNL_MVX_CONFIG = {
  apiBase: "https://api.multiversx.com",
  pageSize: 50,
  tokenMaxPages: 10,
  pairMaxPages: 5,
  pagePauseMs: 80,
  maxAttempts: 3
};
const VOLUME_CONFIG = {
  listingDate: "2024-06-13T00:00:00Z",
  pairAddress: "erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff",
  baseTokenAddress: "TCL-fe459d",
  quoteTokenAddress: "USDC-c76f1f",
  dexUrl: "https://api.dexscreener.com/latest/dex/pairs/multiversx/erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff",
  transferUrlBase: "https://api.multiversx.com/accounts/erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff/transfers",
  transferPageSize: 2000,
  transferMaxPages: 24,
  recentTransferPageSize: 500,
  recentTransferMaxPages: 4
};
const VOLUME_SEED_SNAPSHOT = {
  version: 2,
  buyRows: [
    { label: "2026", cells: [3130.35, 4472.27, 2581.7, 3564.33, 289.41, null, null, null, null, null, null, null] },
    { label: "2025", cells: [9639.22, 9259.28, 14356.93, 11767.26, 14097.41, 9850.55, 8767.28, 4201.1, 5041.02, 13676.96, 4353.24, 3406.88] },
    { label: "2024", cells: [null, null, null, null, null, 12517.95, 6727.19, 5089.2, 13782.33, 9369.75, 7482.87, 8583.4] }
  ],
  sellRows: [
    { label: "2026", cells: [3842.48, 4246.31, 3197.59, 3330.34, 196.13, null, null, null, null, null, null, null] },
    { label: "2025", cells: [11915.78, 7678.72, 14757.07, 10914.74, 15569.59, 13637.45, 9524.72, 8269.9, 5858.98, 11303.04, 3484.76, 3921.12] },
    { label: "2024", cells: [null, null, null, null, null, 11666.05, 9108.81, 2603.8, 9735.67, 14465.25, 7936.13, 7929.6] }
  ],
  totalRows: [
    { label: "2026", cells: [6972.84, 8718.58, 5779.29, 6894.67, 485.53, null, null, null, null, null, null, null] },
    { label: "2025", cells: [21555, 16938, 29114, 22682, 29667, 23488, 18292, 12471, 10900, 24980, 7838, 7328] },
    { label: "2024", cells: [null, null, null, null, null, 24184, 15836, 7693, 23518, 23835, 15419, 16513] }
  ],
  buySummary: { label: "Total", cells: [12769.57, 13731.55, 16938.63, 15331.59, 14386.82, 22368.5, 15494.47, 9290.3, 18823.35, 23046.71, 11836.11, 11990.28] },
  sellSummary: { label: "Total", cells: [15758.26, 11925.03, 17954.66, 14245.08, 15765.72, 25303.5, 18633.53, 10873.7, 15594.65, 25768.29, 11420.89, 11850.72] },
  totalSummary: { label: "Total", cells: [28527.84, 25656.58, 34893.29, 29576.67, 30152.53, 47672, 34128, 20164, 34418, 48815, 23257, 23841] },
  totalVolume: 381101.91,
  buyVolume: 186007.88,
  sellVolume: 195094.03,
  buyTrades: 4479,
  sellTrades: 6264,
  totalTrades: 10743,
  buyDominancePct: 48.81,
  sellDominancePct: 51.19,
  coveredMonths: 24,
  averageMonthlyVolume: 15879.25,
  peakBuyMonth: { year: 2025, monthIndex: 2, value: 14356.93 },
  peakSellMonth: { year: 2025, monthIndex: 4, value: 15569.59 },
  peakTotalMonth: { year: 2025, monthIndex: 4, value: 29667 },
  totalTclAmount: 171635556.0465,
  largestTclTrade: {
    hash: "3de764609b2a217a5a95f49067c3a368cea18377c438c824051a63d6f4abb80c",
    timestamp: 1760886732,
    side: "buy",
    volumeUsd: 6660,
    tclAmount: 5642936.6426,
    description: "Transfer"
  },
  oldestTrade: {
    hash: "6d96b9a735ea91749f56673dc408f0874a9a477d5e5db63e1a9c0f429415d4a1",
    timestamp: 1718301642,
    side: "buy",
    volumeUsd: 165,
    tclAmount: 27049.6602,
    description: "Transfer"
  },
  latestTrade: {
    hash: "9c2067bfcd23208d68c412985f1078fa71b17b029ec94c1177f8addb2ebf0df6",
    timestamp: 1778140890,
    side: "sell",
    volumeUsd: 0.13,
    tclAmount: 157.5,
    description: "Swap 106.5645 TCL for a minimum of 0.000001 USDC"
  },
  fetchMeta: {
    reachedListingStart: false,
    hitPageLimit: false,
    oldestTimestamp: 1718299206,
    exhaustedHistory: true,
    snapshotAt: 1778143726,
    sourceLabel: "cloudflare seed"
  }
};

const EVENT_COPY = {
  en: {
    reminderTitle: "{name} starts in {minutes} min",
    liveTitle: "{name} is live now",
    midpointTitle: "{name} is halfway through",
    endTitle: "{name} has ended",
    defaultBody: "The Cursed Land weekly event"
  },
  ro: {
    reminderTitle: "{name} incepe in {minutes} min",
    liveTitle: "{name} este activ acum",
    midpointTitle: "{name} este la jumatate",
    endTitle: "{name} s-a incheiat",
    defaultBody: "Eveniment saptamanal The Cursed Land"
  }
};

const CLAIM_COPY = {
  en: {
    defaultLabel: "Automatic claim",
    earlyTitle: "Claim reminder: {days} days left",
    earlyBody: "{label}: {days} days left.",
    finalTitle: "Claim reminder: last day",
    finalBody: "{label}: final day."
  },
  ro: {
    defaultLabel: "Revendicare automata",
    earlyTitle: "Reminder claim: mai ai {days} zile",
    earlyBody: "{label}: mai ai {days} zile.",
    finalTitle: "Reminder claim: ultima zi",
    finalBody: "{label}: ultima zi."
  }
};

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env || {}, ctx);
    } catch (error) {
      return emergencyJsonResponse(request, 500, {
        ok: false,
        error: error?.message || "Worker error"
      });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(dispatchDueNotifications(env, { source: "scheduled" }).catch((error) => {
      console.warn("Scheduled event notification dispatch failed", error?.message || error);
      return {
        ok: false,
        error: error?.message || "Scheduled dispatch failed"
      };
    }));

    ctx.waitUntil(dispatchDueClaimReminders(env, { source: "scheduled" }).catch((error) => {
      console.warn("Scheduled claim reminder dispatch failed", error?.message || error);
      return {
        ok: false,
        error: error?.message || "Scheduled claim reminder dispatch failed"
      };
    }));

    ctx.waitUntil(refreshAnalyticsIfDue(env).catch((error) => {
      console.warn("Analytics refresh failed", error?.message || error);
    }));

    ctx.waitUntil(refreshVolumeIfDue(env).catch((error) => {
      console.warn("Volume refresh failed", error?.message || error);
    }));

    ctx.waitUntil(refreshTechnicalsIfDue(env).catch((error) => {
      console.warn("Technicals refresh failed", error?.message || error);
    }));

    const kv = env.TCL_EVENT_PUSH_KV;
    if (!kv) return;

    const today = new Date().toISOString().slice(0, 10);
    ctx.waitUntil((async () => {
      const lastReconcile = await kv.get("stats:last-reconcile");
      const lastClaimReconcile = await kv.get("claim:stats:last-reconcile");
      if (lastReconcile !== today) {
        await reconcileSubscriberCount(kv);
        await kv.put("stats:last-reconcile", today);
      }
      if (lastClaimReconcile !== today) {
        await reconcileClaimReminderCount(kv);
        await kv.put("claim:stats:last-reconcile", today);
      }
    })().catch((error) => {
      console.warn("Subscriber reconcile failed", error?.message || error);
    }));
  }
};

async function isRateLimited(env, ctx, ip, limit = 200, windowSec = 60) {
  if (!env.TCL_EVENT_PUSH_KV || !ip || ip === "unknown") return false;
  const window = Math.floor(Date.now() / (windowSec * 1000));
  const key = `rl:${ip}:${window}`;
  const current = parseInt(await env.TCL_EVENT_PUSH_KV.get(key) || "0");
  if (current >= limit) return true;
  ctx.waitUntil(env.TCL_EVENT_PUSH_KV.put(key, String(current + 1), { expirationTtl: windowSec * 2 }));
  return false;
}

async function handleRequest(request, env, ctx) {
  if (request.method === "OPTIONS") return emptyResponse(request, env);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  // Rate limit: 200 req/min per IP on API endpoints
  if (path.includes("/api/")) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await isRateLimited(env, ctx, ip, 200, 60)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }

  try {
    if (path === "/ads.txt" || path.endsWith("/ads.txt")) {
      return new Response(
        "google.com, pub-1568493858640885, DIRECT, f08c47fec0942fa0\n",
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    if (path.endsWith("/api/prices")) {
      return handlePrices(request, env, ctx);
    }

    if (path.endsWith("/api/marketplace/source")) {
      return handleMarketplaceSource(request, env, url);
    }

    if (path.endsWith("/api/technicals/refresh")) {
      return handleTechnicalsRefresh(request, env);
    }

    if (path.endsWith("/api/technicals")) {
      return handleTechnicals(request, env, ctx);
    }

    if (path.endsWith("/api/pnl") || path.endsWith("/api/pnl/dexscreener")) {
      return handlePnlDexScreener(request, env);
    }

    if (path.endsWith("/api/volume/refresh")) {
      return handleVolumeRefresh(request, env);
    }

    if (path.endsWith("/api/volume")) {
      return handleVolume(request, env, ctx);
    }

    if (path.endsWith("/api/analytics/refresh")) {
      return handleAnalyticsRefresh(request, env);
    }

    if (path.endsWith("/api/analytics")) {
      return handleAnalytics(request, env, ctx);
    }

    if (path.endsWith("/api/push/config")) {
      return handleConfig(request, env);
    }

    if (path.endsWith("/api/push/subscribe")) {
      return handleSubscribe(request, env);
    }

    if (path.endsWith("/api/push/unsubscribe")) {
      return handleUnsubscribe(request, env);
    }

    if (path.endsWith("/api/push/test")) {
      return handleTest(request, env);
    }

    if (path.endsWith("/api/push/claim/upsert")) {
      return handleClaimReminderUpsert(request, env);
    }

    if (path.endsWith("/api/push/claim/delete")) {
      return handleClaimReminderDelete(request, env);
    }

    if (path.endsWith("/api/push/claim/status")) {
      return handleClaimReminderStatus(request, env);
    }

    if (path.endsWith("/api/push/claim/test")) {
      return handleClaimReminderTest(request, env);
    }

    if (path.endsWith("/api/push/claim/stats")) {
      return handleClaimReminderStats(request, env);
    }

    if (path.endsWith("/api/push/dispatch-claims")) {
      return handleClaimReminderDispatch(request, env);
    }

    if (path.endsWith("/api/push/stats/history")) {
      return handleStatsHistory(request, env);
    }

    if (path.endsWith("/api/push/stats/reconcile")) {
      return handleStatsReconcile(request, env);
    }

    if (path.endsWith("/api/push/stats")) {
      return handleStats(request, env);
    }

    if (path.endsWith("/api/push/dispatch-events")) {
      return handleDispatch(request, env);
    }

    return jsonResponse(request, env, 404, {
      ok: false,
      error: "Not found"
    });
  } catch (error) {
    return jsonResponse(request, env, 500, {
      ok: false,
      error: error.message || "Worker error"
    });
  }
}

function getAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configured = env.EVENT_PUSH_ALLOWED_ORIGIN || env.ALLOWED_ORIGIN || "";
  if (!configured) return origin || "*";

  const allowed = configured.split(",").map((item) => item.trim()).filter(Boolean);
  if (allowed.includes("*")) return "*";
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0] || origin || "*";
}

function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(request, env),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

function emergencyCorsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

function emergencyJsonResponse(request, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...emergencyCorsHeaders(request),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function emptyResponse(request, env) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env)
  });
}

function jsonResponse(request, env, status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function handleMarketplaceSource(request, env, url) {
  if (request.method !== "GET") {
    return jsonResponse(request, env, 405, { error: "Method not allowed" });
  }

  const kind = String(url.searchParams.get("kind") || "");
  let upstreamUrl;

  if (kind === "sales") {
    const from = Math.max(0, Number.parseInt(url.searchParams.get("from") || "0", 10) || 0);
    const size = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("size") || "50", 10) || 50));
    upstreamUrl = new URL(`${MARKETPLACE_MVX_API}/accounts/${MARKETPLACE_SC_ADDRESS}/transactions`);
    upstreamUrl.searchParams.set("from", String(from));
    upstreamUrl.searchParams.set("size", String(size));
    upstreamUrl.searchParams.set("status", "success");
    upstreamUrl.searchParams.set("function", "buyNFT");
    upstreamUrl.searchParams.set("withLogs", "true");
  } else if (kind === "pair") {
    const before = Number.parseInt(url.searchParams.get("before") || "0", 10);
    const size = Math.min(500, Math.max(20, Number.parseInt(url.searchParams.get("size") || "200", 10) || 200));
    if (!Number.isFinite(before) || before <= 0) {
      return jsonResponse(request, env, 400, { error: "Invalid before timestamp" });
    }
    upstreamUrl = new URL(`${MARKETPLACE_MVX_API}/accounts/${MARKETPLACE_PAIR_ADDRESS}/transfers`);
    upstreamUrl.searchParams.set("size", String(size));
    upstreamUrl.searchParams.set("status", "success");
    upstreamUrl.searchParams.set("order", "desc");
    upstreamUrl.searchParams.set("before", String(before));
  } else if (kind === "transaction") {
    const hash = String(url.searchParams.get("hash") || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return jsonResponse(request, env, 400, { error: "Invalid transaction hash" });
    }
    upstreamUrl = new URL(`${MARKETPLACE_MVX_API}/transactions/${hash}`);
    upstreamUrl.searchParams.set("withResults", "true");
  } else if (kind === "wallet") {
    const address = String(url.searchParams.get("address") || "");
    if (!isMultiversXAddress(address)) {
      return jsonResponse(request, env, 400, { error: "Invalid address" });
    }
    const [account, token, economics] = await Promise.all([
      fetchAnalyticsJson(`${MARKETPLACE_MVX_API}/accounts/${address}`, 3),
      fetch(`${MARKETPLACE_MVX_API}/accounts/${address}/tokens/${MARKETPLACE_TOKEN}`, {
        headers: { Accept: "application/json", "User-Agent": "TCLExplorerMarketplaceRelay/1.0" },
        cache: "no-store",
      }).then(response => response.ok ? response.json() : null).catch(() => null),
      fetchAnalyticsJson(`${MARKETPLACE_MVX_API}/economics`, 3),
    ]);
    return jsonResponse(request, env, 200, { account, token, economics }, {
      "Cache-Control": "public, max-age=15",
    });
  } else if (kind === "sc-events") {
    const from = Math.max(0, Number.parseInt(url.searchParams.get("from") || "0", 10) || 0);
    const size = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("size") || "50", 10) || 50));
    upstreamUrl = new URL(`${MARKETPLACE_MVX_API}/accounts/${MARKETPLACE_SC_ADDRESS}/transactions`);
    upstreamUrl.searchParams.set("from", String(from));
    upstreamUrl.searchParams.set("size", String(size));
    upstreamUrl.searchParams.set("status", "success");
    upstreamUrl.searchParams.set("fields", "txHash,function,sender,timestamp,data");
  } else if (kind === "sc-query") {
    const scAddress = String(url.searchParams.get("scAddress") || "");
    const funcName = String(url.searchParams.get("funcName") || "");
    const argsParam = String(url.searchParams.get("args") || "");
    if (!scAddress || !funcName) {
      return jsonResponse(request, env, 400, { error: "scAddress and funcName are required" });
    }
    if (!isMultiversXAddress(scAddress)) {
      return jsonResponse(request, env, 400, { error: "Invalid scAddress" });
    }
    const args = argsParam ? argsParam.split(",").filter(Boolean) : [];
    try {
      const mvxResp = await fetch(`${MARKETPLACE_MVX_API}/vm-values/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TCLExplorerMarketplaceRelay/1.0"
        },
        body: JSON.stringify({ scAddress, funcName, args }),
      });
      if (!mvxResp.ok) {
        const errText = await mvxResp.text();
        return jsonResponse(request, env, 502, {
          error: `MVX query failed ${mvxResp.status}: ${errText.slice(0, 120)}`
        });
      }
      const data = await mvxResp.json();
      return jsonResponse(request, env, 200, data, { "Cache-Control": "no-cache" });
    } catch (error) {
      return jsonResponse(request, env, 502, {
        error: error?.message || "MVX vm-values query unavailable"
      });
    }
  } else {
    return jsonResponse(request, env, 400, { error: "Invalid source kind" });
  }

  try {
    const payload = await fetchAnalyticsJson(upstreamUrl.toString(), 3);
    return jsonResponse(request, env, 200, payload, {
      "Cache-Control": "public, max-age=10",
    });
  } catch (error) {
    return jsonResponse(request, env, 502, {
      error: error?.message || "MultiversX source unavailable",
    });
  }
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text);
}

function requireKv(env) {
  if (!env.TCL_EVENT_PUSH_KV) {
    throw new Error("TCL_EVENT_PUSH_KV binding is not configured");
  }
  return env.TCL_EVENT_PUSH_KV;
}

function handleConfig(request, env) {
  return jsonResponse(request, env, 200, {
    ok: true,
    configured: Boolean(env.VAPID_PUBLIC_KEY),
    publicKey: env.VAPID_PUBLIC_KEY || ""
  });
}

async function handlePnlDexScreener(request, env) {
  if (request.method !== "GET") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const url = new URL(request.url);
  const wallet = String(url.searchParams.get("wallet") || "").trim().toLowerCase();
  const refresh = url.searchParams.get("refresh") === "1";

  if (!isMultiversXAddress(wallet)) {
    return jsonResponse(request, env, 400, { ok: false, error: "Invalid wallet address" });
  }

  const kv = env.TCL_EVENT_PUSH_KV;
  const cacheKey = `${PNL_DEXSCREENER_CACHE_PREFIX}${wallet}`;
  if (kv && !refresh) {
    const cached = await kv.get(cacheKey, "json").catch(() => null);
    if (cached?.ok && cached?.wallet === wallet) {
      return jsonResponse(request, env, 200, {
        ...cached,
        meta: {
          ...(cached.meta || {}),
          cached: true
        }
      }, {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300"
      });
    }
  }

  try {
    const warnings = [];
    let result = null;

    if (env.PNL_DEXSCREENER_ENABLED === "1") {
      try {
        result = await fetchDexScreenerPnl(wallet);
      } catch (error) {
        warnings.push(`DexScreener unavailable: ${error?.message || "unknown error"}`);
      }
    }

    if (!result || !result.totals?.tradeCount) {
      result = await fetchMultiversXFilteredPnl(wallet, warnings);
    }

    if (kv) {
      await kv.put(cacheKey, JSON.stringify(result), {
        expirationTtl: PNL_DEXSCREENER_CACHE_TTL_SECONDS
      }).catch(() => {});
    }

    return jsonResponse(request, env, 200, result, {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120"
    });
  } catch (error) {
    return jsonResponse(request, env, 502, {
      ok: false,
      source: "pnl",
      wallet,
      error: error?.message || "PNL unavailable"
    });
  }
}

async function handleSubscribe(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = requireKv(env);
  const body = await readJson(request);
  const subscription = body.subscription || body;

  if (!isValidSubscription(subscription)) {
    return jsonResponse(request, env, 400, { ok: false, error: "Invalid push subscription" });
  }

  const id = await subscriptionId(subscription.endpoint);
  const existing = await kv.get(`${SUBSCRIPTION_PREFIX}${id}`);
  const now = new Date().toISOString();
  const record = {
    id,
    subscription,
    timezone: String(body.timezone || ""),
    lang: normalizeLang(body.lang),
    reminderMinutes: resolveReminderMinutes(body.reminderMinutes),
    userAgent: String(body.userAgent || "").slice(0, 500),
    createdAt: now,
    updatedAt: now
  };

  await kv.put(`${SUBSCRIPTION_PREFIX}${id}`, JSON.stringify(record));
  if (!existing) {
    await adjustSubscriberCount(kv, 1);
  }
  return jsonResponse(request, env, 200, { ok: true, id });
}

async function handleUnsubscribe(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = requireKv(env);
  const body = await readJson(request);
  const subscription = body.subscription || null;
  const id = body.id || (isValidSubscription(subscription) ? await subscriptionId(subscription.endpoint) : "");

  if (!id) {
    return jsonResponse(request, env, 400, { ok: false, error: "Missing subscription id" });
  }

  const existing = await kv.get(`${SUBSCRIPTION_PREFIX}${id}`);
  await kv.delete(`${SUBSCRIPTION_PREFIX}${id}`);
  if (existing) {
    await adjustSubscriberCount(kv, -1);
  }
  return jsonResponse(request, env, 200, { ok: true });
}

async function handleTest(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const body = await readJson(request);
  const subscription = body.subscription || body;
  if (!isValidSubscription(subscription)) {
    return jsonResponse(request, env, 400, { ok: false, error: "Invalid push subscription" });
  }

  const payload = body.payload || {
    title: "TCL event notification test",
    body: "Notifications are working on this device.",
    url: "index.html#events",
    tag: "tcl-event-test"
  };

  await sendWebPush(subscription, payload, env);
  return jsonResponse(request, env, 200, { ok: true });
}

async function handleStats(request, env) {
  if (request.method !== "GET") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = env.TCL_EVENT_PUSH_KV;
  if (!kv) {
    return jsonResponse(request, env, 200, {
      ok: true,
      subscribers: 0,
      configured: false,
      warning: "TCL_EVENT_PUSH_KV binding is not configured",
      updatedAt: new Date().toISOString()
    });
  }

  const stats = await readSubscriberStats(kv);
  const lastDispatch = await readLastDispatch(kv).catch(() => null);
  await recordSubscriberStatsHistory(kv, stats.subscribers).catch(() => {});
  return jsonResponse(request, env, 200, {
    ok: true,
    subscribers: stats.subscribers,
    configured: true,
    source: stats.source,
    lastDispatch,
    updatedAt: new Date().toISOString()
  });
}

async function handleStatsReconcile(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const auth = authorizeDispatch(request, env);
  if (!auth.ok) {
    return jsonResponse(request, env, auth.status, { ok: false, error: auth.error });
  }

  const kv = env.TCL_EVENT_PUSH_KV;
  if (!kv) {
    return jsonResponse(request, env, 503, {
      ok: false,
      error: "TCL_EVENT_PUSH_KV binding is not configured"
    });
  }

  const previous = await readSubscriberStats(kv);
  const subscribers = await reconcileSubscriberCount(kv);
  return jsonResponse(request, env, 200, {
    ok: true,
    subscribers,
    previous: previous.subscribers,
    configured: true,
    source: "kv-list",
    updatedAt: new Date().toISOString()
  });
}

async function handleStatsHistory(request, env) {
  if (request.method !== "GET") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = env.TCL_EVENT_PUSH_KV;
  if (!kv) {
    return jsonResponse(request, env, 200, {
      ok: true,
      history: [],
      configured: false,
      warning: "TCL_EVENT_PUSH_KV binding is not configured"
    });
  }

  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get("days") || 30), 1), 90);
  const history = [];
  const now = new Date();

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - index));
    const day = date.toISOString().slice(0, 10);
    const row = await kv.get(`${STATS_HISTORY_PREFIX}${day}`, "json").catch(() => null);
    if (row) {
      history.push(row);
    }
  }

  return jsonResponse(request, env, 200, {
    ok: true,
    configured: true,
    history
  });
}

async function handleDispatch(request, env) {
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const auth = authorizeDispatch(request, env);
  if (!auth.ok) {
    return jsonResponse(request, env, auth.status, { ok: false, error: auth.error });
  }

  const report = await dispatchDueNotifications(env, { source: "manual" });
  return jsonResponse(request, env, 200, report);
}

async function handleClaimReminderUpsert(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = requireKv(env);
  const body = await readJson(request);
  const subscription = body.subscription || body;

  if (!isValidSubscription(subscription)) {
    return jsonResponse(request, env, 400, { ok: false, error: "Invalid push subscription" });
  }

  const days = normalizeClaimDays(body.days ?? body.remainingDays);
  if (!Number.isFinite(days) || days <= 0) {
    return jsonResponse(request, env, 400, { ok: false, error: "Days must be at least 1" });
  }

  const id = await subscriptionId(subscription.endpoint);
  const key = `${CLAIM_REMINDER_PREFIX}${id}`;
  const existing = await kv.get(key, "json").catch(() => null);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt = nowMs + days * DAY_MS;
  const lang = normalizeLang(body.lang);
  const templates = CLAIM_COPY[lang] || CLAIM_COPY.en;

  const record = {
    ...(existing || {}),
    id,
    subscription,
    enabled: true,
    label: normalizeClaimLabel(body.label, templates.defaultLabel),
    timezone: String(body.timezone || existing?.timezone || ""),
    lang,
    earlyDays: normalizeClaimEarlyDays(body.earlyDays ?? existing?.earlyDays),
    expiresAt,
    userAgent: String(body.userAgent || existing?.userAgent || "").slice(0, 500),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastAction: "set",
    lastInputDays: days
  };

  await kv.put(key, JSON.stringify(record));
  if (!existing) {
    await adjustClaimReminderCount(kv, 1);
  }

  return jsonResponse(request, env, 200, {
    ok: true,
    reminder: publicClaimReminderRecord(record)
  });
}

async function handleClaimReminderDelete(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = requireKv(env);
  const body = await readJson(request);
  const subscription = body.subscription || null;
  const id = body.id || (isValidSubscription(subscription) ? await subscriptionId(subscription.endpoint) : "");

  if (!id) {
    return jsonResponse(request, env, 400, { ok: false, error: "Missing reminder id" });
  }

  const key = `${CLAIM_REMINDER_PREFIX}${id}`;
  const existing = await kv.get(key);
  await kv.delete(key);
  if (existing) {
    await adjustClaimReminderCount(kv, -1);
  }

  return jsonResponse(request, env, 200, { ok: true });
}

async function handleClaimReminderStatus(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = requireKv(env);
  const body = await readJson(request);
  const subscription = body.subscription || null;
  const id = body.id || (isValidSubscription(subscription) ? await subscriptionId(subscription.endpoint) : "");

  if (!id) {
    return jsonResponse(request, env, 400, { ok: false, error: "Missing reminder id" });
  }

  const record = await kv.get(`${CLAIM_REMINDER_PREFIX}${id}`, "json").catch(() => null);
  return jsonResponse(request, env, 200, {
    ok: true,
    reminder: record ? publicClaimReminderRecord(record) : null
  });
}

async function handleClaimReminderTest(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const body = await readJson(request);
  const subscription = body.subscription || body;
  if (!isValidSubscription(subscription)) {
    return jsonResponse(request, env, 400, { ok: false, error: "Invalid push subscription" });
  }

  const lang = normalizeLang(body.lang);
  const templates = CLAIM_COPY[lang] || CLAIM_COPY.en;
  const payload = body.payload || {
    title: "TCL claim reminder test",
    body: formatTemplate(templates.finalBody, { label: templates.defaultLabel, days: 0 }),
    url: "index.html#claimReminder",
    tag: "tcl-claim-reminder-test"
  };

  await sendWebPush(subscription, payload, env);
  return jsonResponse(request, env, 200, { ok: true });
}

async function handleClaimReminderStats(request, env) {
  if (request.method !== "GET") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = env.TCL_EVENT_PUSH_KV;
  if (!kv) {
    return jsonResponse(request, env, 200, {
      ok: true,
      reminders: 0,
      configured: false,
      warning: "TCL_EVENT_PUSH_KV binding is not configured",
      updatedAt: new Date().toISOString()
    });
  }

  const stats = await readClaimReminderStats(kv);
  const lastDispatch = await readClaimReminderLastDispatch(kv).catch(() => null);
  return jsonResponse(request, env, 200, {
    ok: true,
    reminders: stats.reminders,
    configured: true,
    source: stats.source,
    lastDispatch,
    updatedAt: new Date().toISOString()
  });
}

async function handleClaimReminderDispatch(request, env) {
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const auth = authorizeDispatch(request, env);
  if (!auth.ok) {
    return jsonResponse(request, env, auth.status, { ok: false, error: auth.error });
  }

  const report = await dispatchDueClaimReminders(env, { source: "manual" });
  return jsonResponse(request, env, 200, report);
}

async function handleTechnicals(request, env, ctx) {
  if (request.method !== "GET") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = env.TCL_EVENT_PUSH_KV;
  if (!kv) {
    return jsonResponse(request, env, 503, {
      ok: false,
      error: "TCL_EVENT_PUSH_KV binding is not configured"
    });
  }

  const url = new URL(request.url);
  const shouldRefresh = url.searchParams.get("refresh") === "1";
  const shouldBuildFull = shouldRefresh && url.searchParams.get("full") === "1";
  let snapshot = await readTechnicalsSnapshot(kv);

  if (!snapshot) {
    try {
      snapshot = await refreshTechnicalsSnapshot(env, { force: true, full: true });
    } catch (error) {
      return jsonResponse(request, env, 502, {
        ok: false,
        error: error?.message || "Technicals refresh failed"
      });
    }
  } else if (shouldBuildFull) {
    snapshot = await refreshTechnicalsSnapshot(env, { requested: true, full: true });
  } else if (shouldRefresh) {
    snapshot = await refreshTechnicalsSnapshot(env, { current: snapshot, requested: true }).catch((error) => {
      console.warn("Requested technicals refresh failed", error?.message || error);
      return snapshot;
    });
  } else if (isTechnicalsSnapshotDue(snapshot, env)) {
    const refreshPromise = refreshTechnicalsIfDue(env).catch((error) => {
      console.warn("Background technicals refresh failed", error?.message || error);
    });
    if (ctx?.waitUntil) ctx.waitUntil(refreshPromise);
  }

  return jsonResponse(request, env, 200, snapshot, {
    "Cache-Control": shouldRefresh
      ? "public, max-age=15, stale-while-revalidate=120"
      : "public, max-age=60, stale-while-revalidate=300"
  });
}

async function handleTechnicalsRefresh(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const auth = authorizeDispatch(request, env);
  if (!auth.ok) {
    return jsonResponse(request, env, auth.status, { ok: false, error: auth.error });
  }

  const snapshot = await refreshTechnicalsSnapshot(env, { force: true, full: true });
  return jsonResponse(request, env, 200, {
    ok: true,
    updatedAt: snapshot?.meta?.updatedAt || null,
    latestTradeAt: snapshot?.latestTradeTimestamp || null,
    trades: Array.isArray(snapshot?.trades) ? snapshot.trades.length : 0
  });
}

async function handleVolume(request, env, ctx) {
  if (request.method !== "GET") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = env.TCL_EVENT_PUSH_KV;
  if (!kv) {
    return jsonResponse(request, env, 503, {
      ok: false,
      error: "TCL_EVENT_PUSH_KV binding is not configured"
    });
  }

  const url = new URL(request.url);
  const shouldRefresh = url.searchParams.get("refresh") === "1";
  const shouldBuildFull = shouldRefresh && url.searchParams.get("full") === "1";
  let snapshot = await readVolumeSnapshot(kv);

  if (!snapshot) {
    snapshot = await refreshVolumeSnapshot(env, { force: true, full: shouldBuildFull }).catch((error) => {
      console.warn("Initial volume refresh failed", error?.message || error);
      return createVolumeFallbackSnapshot(["Initial Cloudflare refresh failed; serving seed snapshot."]);
    });
  } else if (shouldBuildFull) {
    snapshot = await refreshVolumeSnapshot(env, { requested: true, full: true });
  } else if (shouldRefresh || isVolumeSnapshotDue(snapshot, env)) {
    const refreshPromise = refreshVolumeIfDue(env, { requested: shouldRefresh }).catch((error) => {
      console.warn("Background volume refresh failed", error?.message || error);
    });
    if (ctx?.waitUntil) ctx.waitUntil(refreshPromise);
  }

  return jsonResponse(request, env, 200, snapshot, {
    "Cache-Control": shouldRefresh
      ? "public, max-age=15, stale-while-revalidate=120"
      : "public, max-age=60, stale-while-revalidate=300"
  });
}

async function handleVolumeRefresh(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const auth = authorizeDispatch(request, env);
  if (!auth.ok) {
    return jsonResponse(request, env, auth.status, { ok: false, error: auth.error });
  }

  const snapshot = await refreshVolumeSnapshot(env, { force: true, full: true });
  return jsonResponse(request, env, 200, {
    ok: true,
    updatedAt: snapshot?.meta?.updatedAt || null,
    latestTradeAt: snapshot?.aggregated?.latestTrade?.timestamp || null
  });
}

async function handleAnalytics(request, env, ctx) {
  if (request.method !== "GET") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const kv = env.TCL_EVENT_PUSH_KV;
  if (!kv) {
    return jsonResponse(request, env, 503, {
      ok: false,
      error: "TCL_EVENT_PUSH_KV binding is not configured"
    });
  }

  let snapshot = await readAnalyticsSnapshot(kv);
  if (!snapshot) {
    try {
      snapshot = await refreshAnalyticsSnapshot(env, { force: true });
    } catch (error) {
      return jsonResponse(request, env, 502, {
        ok: false,
        error: error?.message || "Analytics refresh failed"
      });
    }
  } else if (isAnalyticsSnapshotDue(snapshot, env)) {
    const refreshPromise = refreshAnalyticsIfDue(env).catch((error) => {
      console.warn("Background analytics refresh failed", error?.message || error);
    });
    if (ctx?.waitUntil) ctx.waitUntil(refreshPromise);
  }

  return jsonResponse(request, env, 200, snapshot, {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=600"
  });
}

async function handleAnalyticsRefresh(request, env) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  const auth = authorizeDispatch(request, env);
  if (!auth.ok) {
    return jsonResponse(request, env, auth.status, { ok: false, error: auth.error });
  }

  const snapshot = await refreshAnalyticsSnapshot(env, { force: true });
  return jsonResponse(request, env, 200, {
    ok: true,
    updatedAt: snapshot?.meta?.updatedAt || null
  });
}

// ── Prices endpoint ──────────────────────────────────────────────────────────

async function handlePrices(request, env, ctx) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: pricesCorsHeaders() });
  }

  const kv = env.TCL_EVENT_PUSH_KV;
  const now = Math.floor(Date.now() / 1000);

  if (kv) {
    const cached = await kv.get(PRICES_SNAPSHOT_KEY, "json");
    if (cached) {
      const age = now - (cached.cachedAt || 0);
      if (age >= PRICES_CACHE_TTL_SECONDS) {
        ctx.waitUntil(refreshPricesSnapshot(kv, now));
      }
      return pricesJsonResponse({ ...cached, age });
    }
  }

  const snapshot = await fetchPricesSnapshot(kv, now);
  if (kv) {
    ctx.waitUntil(kv.put(PRICES_SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: 300 }));
  }
  return pricesJsonResponse({ ...snapshot, age: 0 });
}

function pricesCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400"
  };
}

function pricesJsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      ...pricesCorsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30"
    }
  });
}

async function refreshPricesSnapshot(kv, now) {
  try {
    const snapshot = await fetchPricesSnapshot(kv, now);
    await kv.put(PRICES_SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: 300 });
  } catch (e) {
    console.warn("Prices snapshot refresh failed", e?.message || e);
  }
}

async function fetchPricesSnapshot(kv, now) {
  // Gecko has its own 1hr cache to avoid rate limits
  let gecko = PRICES_GECKO_FALLBACK;
  if (kv) {
    const cachedGecko = await kv.get(PRICES_GECKO_KEY, "json");
    if (cachedGecko && (now - (cachedGecko.cachedAt || 0)) < PRICES_GECKO_TTL_SECONDS) {
      gecko = { ath: cachedGecko.ath, atl: cachedGecko.atl };
    } else {
      try {
        const geckoRes = await fetch(PRICES_GECKO_URL);
        if (geckoRes.ok) {
          const arr = await geckoRes.json();
          if (Array.isArray(arr) && arr[0]) {
            gecko = { ath: Number(arr[0].ath) || gecko.ath, atl: Number(arr[0].atl) || gecko.atl };
            await kv.put(PRICES_GECKO_KEY, JSON.stringify({ ...gecko, cachedAt: now }), { expirationTtl: PRICES_GECKO_TTL_SECONDS });
          }
        }
      } catch (e) {
        console.warn("Gecko fetch failed, using fallback/cached", e?.message);
        if (cachedGecko) gecko = { ath: cachedGecko.ath, atl: cachedGecko.atl };
      }
    }
  }

  const [tclRes, egldRes, tokenRes] = await Promise.all([
    fetch(PRICES_TCL_PAIR_URL),
    fetch(PRICES_EGLD_PAIR_URL),
    fetch(PRICES_TOKEN_URL)
  ]);

  const tclData = tclRes.ok ? await tclRes.json() : {};
  const egldData = egldRes.ok ? await egldRes.json() : {};
  const tokenData = tokenRes.ok ? await tokenRes.json() : {};

  const pair = tclData.pair || (Array.isArray(tclData.pairs) ? tclData.pairs[0] : null) || {};
  const egldPair = egldData.pair || (Array.isArray(egldData.pairs) ? egldData.pairs[0] : null) || {};

  return {
    ok: true,
    pair,
    pairs: [pair],
    token: tokenData,
    gecko,
    egld: { price: parseFloat(egldPair.priceUsd) || 0, pair: egldPair },
    cachedAt: now
  };
}

function authorizeDispatch(request, env) {
  const secret = env.EVENT_PUSH_CRON_SECRET || env.CRON_SECRET || "";
  if (!secret) {
    return { ok: false, status: 503, error: "EVENT_PUSH_CRON_SECRET is not configured" };
  }

  const header = request.headers.get("Authorization") || "";
  return header === `Bearer ${secret}`
    ? { ok: true }
    : { ok: false, status: 401, error: "Unauthorized" };
}

async function refreshTechnicalsIfDue(env, options = {}) {
  const kv = requireKv(env);
  const current = await readTechnicalsSnapshot(kv);
  if (current && !options.requested && !isTechnicalsSnapshotDue(current, env)) return current;
  return refreshTechnicalsSnapshot(env, {
    current,
    requested: options.requested === true
  });
}

async function refreshTechnicalsSnapshot(env, options = {}) {
  const kv = requireKv(env);
  const current = options.current || await readTechnicalsSnapshot(kv);
  if (!options.force && !options.requested && current && !isTechnicalsSnapshotDue(current, env)) return current;

  let locked = true;
  if (!options.force) {
    locked = await reserveTechnicalsRefreshLock(kv);
    if (!locked) return current;
  }

  try {
    const snapshot = await buildTechnicalsSnapshot(current, {
      full: options.full === true || !current
    });
    await kv.put(TECHNICALS_SNAPSHOT_KEY, JSON.stringify(snapshot));
    return snapshot;
  } finally {
    if (!options.force && locked) {
      await kv.delete(TECHNICALS_REFRESH_LOCK_KEY).catch(() => {});
    }
  }
}

async function readTechnicalsSnapshot(kv) {
  const snapshot = await kv.get(TECHNICALS_SNAPSHOT_KEY, "json").catch(() => null);
  return hasValidTechnicalsSnapshot(snapshot) ? snapshot : null;
}

async function reserveTechnicalsRefreshLock(kv) {
  const existing = await kv.get(TECHNICALS_REFRESH_LOCK_KEY);
  if (existing) return false;
  await kv.put(TECHNICALS_REFRESH_LOCK_KEY, String(Date.now()), {
    expirationTtl: TECHNICALS_REFRESH_LOCK_TTL_SECONDS
  });
  return true;
}

function isTechnicalsSnapshotDue(snapshot, env) {
  const updatedAt = snapshot?.meta?.updatedAt ? new Date(snapshot.meta.updatedAt).getTime() : 0;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return true;
  return Date.now() - updatedAt >= technicalsRefreshIntervalMs(env);
}

function technicalsRefreshIntervalMs(env) {
  const minutes = Number(env.TECHNICALS_REFRESH_INTERVAL_MINUTES || DEFAULT_TECHNICALS_REFRESH_INTERVAL_MINUTES);
  const safeMinutes = Number.isFinite(minutes) ? Math.min(60, Math.max(2, minutes)) : DEFAULT_TECHNICALS_REFRESH_INTERVAL_MINUTES;
  return safeMinutes * 60 * 1000;
}

async function buildTechnicalsSnapshot(currentSnapshot = null, options = {}) {
  const warnings = [];
  const nowSec = Math.floor(Date.now() / 1000);
  let pair = currentSnapshot?.pair || null;

  try {
    pair = await fetchVolumeDexPair();
  } catch (error) {
    warnings.push(`DexScreener unavailable: ${error?.message || "unknown error"}`);
  }

  const pairReference = {
    pairAddress: pair?.pairAddress || currentSnapshot?.pair?.pairAddress || VOLUME_CONFIG.pairAddress,
    baseToken: {
      address: pair?.baseToken?.address || currentSnapshot?.pair?.baseToken?.address || VOLUME_CONFIG.baseTokenAddress
    },
    quoteToken: {
      address: pair?.quoteToken?.address || currentSnapshot?.pair?.quoteToken?.address || VOLUME_CONFIG.quoteTokenAddress
    }
  };
  const baseTrades = normalizeTechnicalsTrades(currentSnapshot?.trades);
  const latestTimestamp = Number(currentSnapshot?.latestTradeTimestamp ?? baseTrades[baseTrades.length - 1]?.timestamp);

  if (options.full || !baseTrades.length) {
    try {
      const fullHistory = await fetchVolumeTransferHistory();
      const fullTrades = normalizeTechnicalsTrades(parseVolumeTrades(fullHistory.transfers, pairReference));
      if (!fullTrades.length) {
        throw new Error("No swap trades were parsed from the full MultiversX transfers feed.");
      }

      return createTechnicalsSnapshot({
        pair,
        trades: fullTrades,
        warnings,
        fetchMeta: {
          reachedListingStart: fullHistory.reachedListingStart === true,
          hitPageLimit: fullHistory.hitPageLimit === true,
          oldestTimestamp: fullHistory.oldestTimestamp ?? null,
          exhaustedHistory: fullHistory.exhaustedHistory !== false,
          recentTransfers: fullHistory.transfers.length,
          parsedTrades: fullTrades.length,
          snapshotAt: nowSec,
          sourceLabel: "cloudflare full"
        }
      });
    } catch (error) {
      warnings.push(`Full MultiversX refresh unavailable: ${error?.message || "unknown error"}`);
      if (!baseTrades.length) throw error;
    }
  }

  let recentHistory = {
    transfers: [],
    hitPageLimit: false,
    oldestTimestamp: null,
    exhaustedHistory: true
  };
  try {
    recentHistory = await fetchVolumeRecentTransferHistory(latestTimestamp);
  } catch (error) {
    warnings.push(`MultiversX transfers unavailable: ${error?.message || "unknown error"}`);
  }

  const liveTrades = normalizeTechnicalsTrades(parseVolumeTrades(recentHistory.transfers, pairReference));
  const trades = mergeTechnicalTradeLists(baseTrades, liveTrades);
  if (!trades.length) {
    throw new Error("No cached swap trades are available for TCL technicals.");
  }

  return createTechnicalsSnapshot({
    pair,
    trades,
    warnings,
    fetchMeta: {
      hitPageLimit: recentHistory.hitPageLimit === true,
      oldestTimestamp: recentHistory.oldestTimestamp ?? null,
      exhaustedHistory: recentHistory.exhaustedHistory !== false,
      recentTransfers: Array.isArray(recentHistory.transfers) ? recentHistory.transfers.length : 0,
      parsedTrades: liveTrades.length,
      snapshotAt: nowSec,
      sourceLabel: liveTrades.length ? "cloudflare cache + live" : "cloudflare cache"
    }
  });
}

function createTechnicalsSnapshot({ pair, trades, warnings, fetchMeta }) {
  const normalizedTrades = normalizeTechnicalsTrades(trades);
  const latestTradeTimestamp = Number(normalizedTrades[normalizedTrades.length - 1]?.timestamp) || 0;

  return {
    ok: true,
    version: 1,
    meta: {
      updatedAt: new Date().toISOString(),
      source: "Cloudflare Worker",
      endpoints: {
        dex: VOLUME_CONFIG.dexUrl,
        transfers: VOLUME_CONFIG.transferUrlBase
      },
      warnings: Array.isArray(warnings) ? warnings : [],
      fetchMeta
    },
    pair,
    trades: normalizedTrades,
    latestTradeTimestamp
  };
}

function hasValidTechnicalsSnapshot(snapshot) {
  return Boolean(
    snapshot &&
    snapshot.meta &&
    Array.isArray(snapshot.trades) &&
    snapshot.trades.length &&
    snapshot.trades.every(isValidTechnicalTrade)
  );
}

function isValidTechnicalTrade(trade) {
  return Boolean(
    trade &&
    typeof trade.hash === "string" &&
    trade.hash.length &&
    Number.isFinite(Number(trade.timestamp)) &&
    Number.isFinite(Number(trade.price)) &&
    Number(trade.price) > 0 &&
    Number.isFinite(Number(trade.volumeUsd)) &&
    Number(trade.volumeUsd) > 0 &&
    Number.isFinite(Number(trade.tclAmount)) &&
    Number(trade.tclAmount) > 0 &&
    (trade.side === "buy" || trade.side === "sell")
  );
}

function normalizeTechnicalTrade(trade) {
  return {
    hash: String(trade.hash),
    timestamp: Number(trade.timestamp),
    price: Number(trade.price),
    volumeUsd: Number(trade.volumeUsd),
    tclAmount: Number(trade.tclAmount),
    side: trade.side,
    description: typeof trade.description === "string" ? trade.description : ""
  };
}

function normalizeTechnicalsTrades(trades) {
  return (Array.isArray(trades) ? trades : [])
    .filter(isValidTechnicalTrade)
    .map(normalizeTechnicalTrade)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function mergeTechnicalTradeLists(existingTrades, incomingTrades) {
  const merged = new Map();

  for (const trade of existingTrades || []) {
    if (isValidTechnicalTrade(trade)) {
      merged.set(trade.hash, normalizeTechnicalTrade(trade));
    }
  }

  for (const trade of incomingTrades || []) {
    if (isValidTechnicalTrade(trade)) {
      merged.set(trade.hash, normalizeTechnicalTrade(trade));
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.timestamp - right.timestamp);
}

async function refreshVolumeIfDue(env, options = {}) {
  const kv = requireKv(env);
  const current = await readVolumeSnapshot(kv);
  if (current && !options.requested && !isVolumeSnapshotDue(current, env)) return current;
  return refreshVolumeSnapshot(env, { current, requested: options.requested === true });
}

async function refreshVolumeSnapshot(env, options = {}) {
  const kv = requireKv(env);
  const current = options.current || await readVolumeSnapshot(kv);
  if (!options.force && !options.requested && current && !isVolumeSnapshotDue(current, env)) return current;

  let locked = true;
  if (!options.force) {
    locked = await reserveVolumeRefreshLock(kv);
    if (!locked) return current || createVolumeFallbackSnapshot(["Volume refresh already in progress."]);
  }

  try {
    const snapshot = await buildVolumeSnapshot(current, { full: options.full === true });
    await kv.put(VOLUME_SNAPSHOT_KEY, JSON.stringify(snapshot));
    return snapshot;
  } finally {
    if (!options.force && locked) {
      await kv.delete(VOLUME_REFRESH_LOCK_KEY).catch(() => {});
    }
  }
}

async function readVolumeSnapshot(kv) {
  const snapshot = await kv.get(VOLUME_SNAPSHOT_KEY, "json").catch(() => null);
  return snapshot?.meta && hasValidVolumeAggregatedShape(snapshot.aggregated) ? snapshot : null;
}

async function reserveVolumeRefreshLock(kv) {
  const existing = await kv.get(VOLUME_REFRESH_LOCK_KEY);
  if (existing) return false;
  await kv.put(VOLUME_REFRESH_LOCK_KEY, String(Date.now()), {
    expirationTtl: VOLUME_REFRESH_LOCK_TTL_SECONDS
  });
  return true;
}

function isVolumeSnapshotDue(snapshot, env) {
  const updatedAt = snapshot?.meta?.updatedAt ? new Date(snapshot.meta.updatedAt).getTime() : 0;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return true;
  return Date.now() - updatedAt >= volumeRefreshIntervalMs(env);
}

function volumeRefreshIntervalMs(env) {
  const minutes = Number(env.VOLUME_REFRESH_INTERVAL_MINUTES || DEFAULT_VOLUME_REFRESH_INTERVAL_MINUTES);
  const safeMinutes = Number.isFinite(minutes) ? Math.min(60, Math.max(2, minutes)) : DEFAULT_VOLUME_REFRESH_INTERVAL_MINUTES;
  return safeMinutes * 60 * 1000;
}

async function buildVolumeSnapshot(currentSnapshot = null, options = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const warnings = [];
  let pair = currentSnapshot?.pair || null;
  let recentHistory = {
    transfers: [],
    hitPageLimit: false,
    oldestTimestamp: null,
    exhaustedHistory: true
  };

  try {
    pair = await fetchVolumeDexPair();
  } catch (error) {
    warnings.push(`DexScreener unavailable: ${error?.message || "unknown error"}`);
  }

  const baseAggregated = hasValidVolumeAggregatedShape(currentSnapshot?.aggregated)
    ? currentSnapshot.aggregated
    : VOLUME_SEED_SNAPSHOT;
  const normalizedBase = normalizeVolumeAggregatedSnapshot(baseAggregated, new Date());
  const latestTimestamp = Number(normalizedBase?.latestTrade?.timestamp);

  try {
    recentHistory = await fetchVolumeRecentTransferHistory(latestTimestamp);
  } catch (error) {
    warnings.push(`MultiversX transfers unavailable: ${error?.message || "unknown error"}`);
  }

  const pairReference = {
    pairAddress: pair?.pairAddress || VOLUME_CONFIG.pairAddress,
    baseToken: { address: pair?.baseToken?.address || VOLUME_CONFIG.baseTokenAddress },
    quoteToken: { address: pair?.quoteToken?.address || VOLUME_CONFIG.quoteTokenAddress }
  };

  if (options.full) {
    try {
      const fullHistory = await fetchVolumeTransferHistory();
      const fullTrades = parseVolumeTrades(fullHistory.transfers, pairReference);
      if (!fullTrades.length) {
        throw new Error("No swap trades were parsed from the full MultiversX transfers feed.");
      }

      const aggregated = aggregateVolumeTrades(fullTrades, {
        reachedListingStart: fullHistory.reachedListingStart === true,
        hitPageLimit: fullHistory.hitPageLimit === true,
        oldestTimestamp: fullHistory.oldestTimestamp ?? null,
        exhaustedHistory: fullHistory.exhaustedHistory !== false,
        recentTransfers: fullHistory.transfers.length,
        parsedTrades: fullTrades.length,
        snapshotAt: nowSec,
        sourceLabel: "cloudflare full"
      });

      return {
        ok: true,
        meta: {
          updatedAt: new Date().toISOString(),
          source: "Cloudflare Worker",
          endpoints: {
            dex: VOLUME_CONFIG.dexUrl,
            transfers: VOLUME_CONFIG.transferUrlBase
          },
          warnings
        },
        pair,
        aggregated
      };
    } catch (error) {
      warnings.push(`Full MultiversX refresh unavailable: ${error?.message || "unknown error"}`);
    }
  }

  const trades = parseVolumeTrades(recentHistory.transfers, pairReference);
  const sourceLabel = trades.length ? "cloudflare cache + live" : "cloudflare cache";
  const fetchMeta = {
    hitPageLimit: recentHistory.hitPageLimit === true,
    oldestTimestamp: recentHistory.oldestTimestamp ?? null,
    exhaustedHistory: recentHistory.exhaustedHistory !== false,
    recentTransfers: Array.isArray(recentHistory.transfers) ? recentHistory.transfers.length : 0,
    parsedTrades: trades.length,
    snapshotAt: nowSec,
    sourceLabel
  };

  const aggregated = trades.length
    ? mergeVolumeTradesIntoAggregated(normalizedBase, trades, fetchMeta)
    : rebuildVolumeAggregatedDerivedState({
      ...normalizedBase,
      fetchMeta: {
        ...(normalizedBase.fetchMeta || {}),
        ...fetchMeta
      }
    });

  return {
    ok: true,
    meta: {
      updatedAt: new Date().toISOString(),
      source: "Cloudflare Worker",
      endpoints: {
        dex: VOLUME_CONFIG.dexUrl,
        transfers: VOLUME_CONFIG.transferUrlBase
      },
      warnings
    },
    pair,
    aggregated
  };
}

function createVolumeFallbackSnapshot(warnings = []) {
  const nowSec = Math.floor(Date.now() / 1000);
  const aggregated = rebuildVolumeAggregatedDerivedState({
    ...normalizeVolumeAggregatedSnapshot(VOLUME_SEED_SNAPSHOT, new Date()),
    fetchMeta: {
      ...(VOLUME_SEED_SNAPSHOT.fetchMeta || {}),
      snapshotAt: nowSec,
      sourceLabel: "cloudflare seed"
    }
  });

  return {
    ok: true,
    meta: {
      updatedAt: new Date().toISOString(),
      source: "Cloudflare Worker",
      endpoints: {
        dex: VOLUME_CONFIG.dexUrl,
        transfers: VOLUME_CONFIG.transferUrlBase
      },
      warnings
    },
    pair: null,
    aggregated
  };
}

async function fetchVolumeDexPair() {
  const payload = await fetchAnalyticsJson(VOLUME_CONFIG.dexUrl, 3);
  return payload?.pair || (Array.isArray(payload?.pairs) ? payload.pairs[0] : null);
}

async function fetchVolumeTransferHistory() {
  const transfers = [];
  const listingTimestamp = Math.floor(new Date(VOLUME_CONFIG.listingDate).getTime() / 1000);
  let oldestTimestamp = null;
  let reachedListingStart = false;
  let hitPageLimit = false;
  let exhaustedHistory = false;
  let beforeCursor = null;

  for (let pageIndex = 0; pageIndex < VOLUME_CONFIG.transferMaxPages; pageIndex += 1) {
    const params = new URLSearchParams({
      size: String(VOLUME_CONFIG.transferPageSize),
      status: "success",
      order: "desc"
    });
    if (beforeCursor != null) {
      params.set("before", String(beforeCursor));
    }

    const page = await fetchAnalyticsJson(`${VOLUME_CONFIG.transferUrlBase}?${params.toString()}`, 3);
    if (!Array.isArray(page) || !page.length) {
      exhaustedHistory = true;
      break;
    }

    transfers.push(...page);

    const pageTimestamps = page
      .map((item) => Number(item?.timestamp))
      .filter((timestamp) => Number.isFinite(timestamp));

    if (pageTimestamps.length) {
      oldestTimestamp = oldestTimestamp == null
        ? Math.min(...pageTimestamps)
        : Math.min(oldestTimestamp, ...pageTimestamps);
    }

    if (oldestTimestamp != null && oldestTimestamp <= listingTimestamp) {
      reachedListingStart = true;
      break;
    }

    if (page.length < VOLUME_CONFIG.transferPageSize) {
      exhaustedHistory = true;
      break;
    }

    beforeCursor = oldestTimestamp != null ? oldestTimestamp - 1 : null;
    if (beforeCursor == null || beforeCursor <= 0) {
      exhaustedHistory = true;
      break;
    }

    if (pageIndex === VOLUME_CONFIG.transferMaxPages - 1) {
      hitPageLimit = true;
    }
  }

  return {
    transfers,
    reachedListingStart,
    hitPageLimit,
    oldestTimestamp,
    exhaustedHistory
  };
}

async function fetchVolumeRecentTransferHistory(afterTimestamp) {
  if (!Number.isFinite(afterTimestamp)) {
    return {
      transfers: [],
      hitPageLimit: false,
      oldestTimestamp: null,
      exhaustedHistory: true
    };
  }

  const transfers = [];
  let newestTimestamp = null;
  let hitPageLimit = false;
  let exhaustedHistory = false;
  let afterCursor = Math.floor(afterTimestamp) + 1;

  for (let pageIndex = 0; pageIndex < VOLUME_CONFIG.recentTransferMaxPages; pageIndex += 1) {
    const params = new URLSearchParams({
      size: String(VOLUME_CONFIG.recentTransferPageSize),
      status: "success",
      order: "asc",
      after: String(afterCursor)
    });
    const page = await fetchAnalyticsJson(`${VOLUME_CONFIG.transferUrlBase}?${params.toString()}`, 3);

    if (!Array.isArray(page) || !page.length) {
      exhaustedHistory = true;
      break;
    }

    transfers.push(...page);

    const pageTimestamps = page
      .map((item) => Number(item?.timestamp))
      .filter((timestamp) => Number.isFinite(timestamp));

    if (pageTimestamps.length) {
      newestTimestamp = newestTimestamp == null
        ? Math.max(...pageTimestamps)
        : Math.max(newestTimestamp, ...pageTimestamps);
    }

    if (page.length < VOLUME_CONFIG.recentTransferPageSize) {
      exhaustedHistory = true;
      break;
    }

    afterCursor = newestTimestamp != null ? newestTimestamp + 1 : afterCursor + 1;
    if (!Number.isFinite(afterCursor) || afterCursor <= 0) {
      exhaustedHistory = true;
      break;
    }

    if (pageIndex === VOLUME_CONFIG.recentTransferMaxPages - 1) {
      hitPageLimit = true;
    }
  }

  return {
    transfers,
    hitPageLimit,
    oldestTimestamp: transfers.length ? Number(transfers[0]?.timestamp) || null : null,
    exhaustedHistory
  };
}

function hasValidVolumeAggregatedShape(value) {
  return Boolean(
    value &&
    Array.isArray(value.buyRows) &&
    Array.isArray(value.sellRows) &&
    Array.isArray(value.totalRows) &&
    value.latestTrade &&
    Number.isFinite(Number(value.latestTrade.timestamp))
  );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function decimalStringToNumber(value, decimals) {
  if (typeof value !== "string" || !value.length) return Number.NaN;
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  if (!/^\d+$/.test(digits)) return Number.NaN;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals);
  const formatted = decimals > 0 ? `${whole}.${fraction}` : whole;
  const numeric = Number(negative ? `-${formatted}` : formatted);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function resolveVolumeTokenDecimals(token, pair) {
  if (token === pair?.quoteToken?.address || token === VOLUME_CONFIG.quoteTokenAddress) return 6;
  return 18;
}

function normalizeVolumeTradeTransfer(transfer, pair) {
  if (!transfer?.token || !transfer?.value) return null;
  const decimals = Number(transfer.decimals ?? resolveVolumeTokenDecimals(transfer.token, pair));
  const amount = decimalStringToNumber(transfer.value, decimals);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    token: transfer.token,
    amount
  };
}

function parseVolumeTrades(transfers, pair) {
  const tradeList = [];
  const groupedSwaps = new Map();

  for (const entry of Array.isArray(transfers) ? transfers : []) {
    if (entry?.status !== "success") continue;

    const transferList = entry?.action?.arguments?.transfers;
    if (!Array.isArray(transferList) || !transferList.length) continue;

    const primaryTransfer = normalizeVolumeTradeTransfer(transferList[0], pair);
    if (!primaryTransfer) continue;

    const timestamp = Number(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;

    const groupHash = String(entry.originalTxHash || entry.txHash || "");
    if (!groupHash) continue;

    let groupedSwap = groupedSwaps.get(groupHash);
    if (!groupedSwap) {
      groupedSwap = {
        hash: groupHash,
        timestamp,
        inputToken: null,
        inputAmount: 0,
        outputToken: null,
        outputAmount: 0,
        description: "",
        invalid: false
      };
      groupedSwaps.set(groupHash, groupedSwap);
    } else if (timestamp < groupedSwap.timestamp) {
      groupedSwap.timestamp = timestamp;
    }

    if (!groupedSwap.description && entry?.action?.description) {
      groupedSwap.description = entry.action.description;
    }

    if (entry.receiver === pair?.pairAddress && entry.function === "swapTokensFixedInput") {
      if (groupedSwap.inputToken && groupedSwap.inputToken !== primaryTransfer.token) {
        groupedSwap.invalid = true;
        continue;
      }
      groupedSwap.inputToken = primaryTransfer.token;
      groupedSwap.inputAmount += primaryTransfer.amount;
      continue;
    }

    const isPairOutput =
      entry.sender === pair?.pairAddress &&
      entry.function !== "depositSwapFees" &&
      (primaryTransfer.token === pair?.baseToken?.address || primaryTransfer.token === pair?.quoteToken?.address);

    if (!isPairOutput) continue;

    if (groupedSwap.outputToken && groupedSwap.outputToken !== primaryTransfer.token) {
      groupedSwap.invalid = true;
      continue;
    }

    groupedSwap.outputToken = primaryTransfer.token;
    groupedSwap.outputAmount += primaryTransfer.amount;
  }

  for (const groupedSwap of groupedSwaps.values()) {
    if (groupedSwap.invalid) continue;

    const hasValidInput = groupedSwap.inputAmount > 0 && typeof groupedSwap.inputToken === "string";
    const hasValidOutput = groupedSwap.outputAmount > 0 && typeof groupedSwap.outputToken === "string";
    if (!hasValidInput || !hasValidOutput) continue;

    let tclAmount = 0;
    let usdcAmount = 0;
    let side = null;

    if (
      groupedSwap.inputToken === pair.quoteToken.address &&
      groupedSwap.outputToken === pair.baseToken.address
    ) {
      usdcAmount = groupedSwap.inputAmount;
      tclAmount = groupedSwap.outputAmount;
      side = "buy";
    } else if (
      groupedSwap.inputToken === pair.baseToken.address &&
      groupedSwap.outputToken === pair.quoteToken.address
    ) {
      tclAmount = groupedSwap.inputAmount;
      usdcAmount = groupedSwap.outputAmount;
      side = "sell";
    } else {
      continue;
    }

    const price = usdcAmount / tclAmount;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(usdcAmount) || usdcAmount <= 0) continue;

    tradeList.push({
      hash: groupedSwap.hash,
      timestamp: groupedSwap.timestamp,
      side,
      price,
      volumeUsd: usdcAmount,
      tclAmount,
      description: groupedSwap.description
    });
  }

  return tradeList.sort((left, right) => left.timestamp - right.timestamp);
}

function isMultiversXAddress(value) {
  return /^erd1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(String(value || "").trim());
}

function buildDexScreenerPnlUrl(wallet, beforeBlockNumber = null) {
  const config = PNL_DEXSCREENER_CONFIG;
  const url = new URL(`${config.logsBaseUrl}/${config.ammId}/all/${config.chainId}/${encodeURIComponent(config.pairAddress)}`);
  url.searchParams.set("q", config.quoteTokenAddress);
  url.searchParams.set("m", wallet);
  url.searchParams.set("c", "1");
  if (Number.isFinite(beforeBlockNumber) && beforeBlockNumber > 0) {
    url.searchParams.set("bbn", String(Math.floor(beforeBlockNumber)));
  }
  return url.toString();
}

async function fetchDexScreenerJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= PNL_DEXSCREENER_CONFIG.maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Referer: "https://dexscreener.com/"
        },
        cache: "no-store"
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`DexScreener HTTP ${response.status}${text ? `: ${text.slice(0, 80)}` : ""}`);
      }

      const payload = await response.json();
      if (!payload || !Array.isArray(payload.logs)) {
        throw new Error("DexScreener response did not contain logs");
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= PNL_DEXSCREENER_CONFIG.maxAttempts) break;
      await sleep(800 * attempt);
    }
  }

  throw new Error(lastError?.message || "DexScreener logs unavailable");
}

function normalizeDexTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp > 10000000000 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
}

function normalizeDexNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function parseDexScreenerPnlTrade(log) {
  if (!log || log.logType !== "swap") return null;
  if (log.txnType !== "buy" && log.txnType !== "sell") return null;

  const tclAmount = normalizeDexNumber(log.amount0);
  const quoteAmount = normalizeDexNumber(log.amount1);
  const volumeUsd = normalizeDexNumber(log.volumeUsd) || quoteAmount;
  const timestamp = normalizeDexTimestamp(log.blockTimestamp);
  const blockNumber = Number(log.blockNumber);
  const logIndex = Number(log.logIndex);
  const hash = String(log.txnHash || "");

  if (!hash || !timestamp || !Number.isFinite(blockNumber) || blockNumber <= 0) return null;
  if (!Number.isFinite(tclAmount) || tclAmount <= 0 || !Number.isFinite(volumeUsd) || volumeUsd <= 0) return null;

  return {
    hash,
    key: `${hash}:${Number.isFinite(logIndex) ? logIndex : 0}`,
    timestamp,
    blockNumber,
    side: log.txnType,
    price: normalizeDexNumber(log.priceUsd) || (volumeUsd / tclAmount),
    volumeUsd,
    tclAmount,
    description: "DexScreener TCL/USDC swap"
  };
}

function aggregatePnlDexTrades(trades) {
  return trades.reduce((totals, trade) => {
    if (trade.side === "buy") {
      totals.buyCount += 1;
      totals.buyTcl += trade.tclAmount;
      totals.buyUsd += trade.volumeUsd;
    } else if (trade.side === "sell") {
      totals.sellCount += 1;
      totals.sellTcl += trade.tclAmount;
      totals.sellUsd += trade.volumeUsd;
    }
    totals.tradeCount += 1;
    return totals;
  }, {
    tradeCount: 0,
    buyCount: 0,
    sellCount: 0,
    buyTcl: 0,
    sellTcl: 0,
    buyUsd: 0,
    sellUsd: 0
  });
}

async function fetchDexScreenerPnl(wallet) {
  const tradeMap = new Map();
  let beforeBlockNumber = null;
  let oldestBlockNumber = null;
  let newestBlockNumber = null;
  let oldestTimestamp = null;
  let pageCount = 0;
  let checkedLogs = 0;
  let exhaustedHistory = false;
  let hitPageLimit = false;

  for (let pageIndex = 0; pageIndex < PNL_DEXSCREENER_CONFIG.maxPages; pageIndex += 1) {
    const payload = await fetchDexScreenerJson(buildDexScreenerPnlUrl(wallet, beforeBlockNumber));
    const logs = Array.isArray(payload.logs) ? payload.logs : [];

    if (!logs.length) {
      exhaustedHistory = true;
      break;
    }

    pageCount += 1;
    checkedLogs += logs.length;

    const blockNumbers = [];
    for (const log of logs) {
      const blockNumber = Number(log?.blockNumber);
      if (Number.isFinite(blockNumber) && blockNumber > 0) blockNumbers.push(blockNumber);

      const timestamp = normalizeDexTimestamp(log?.blockTimestamp);
      if (timestamp) {
        oldestTimestamp = oldestTimestamp == null ? timestamp : Math.min(oldestTimestamp, timestamp);
      }

      const maker = String(log?.maker || "").toLowerCase();
      if (maker && maker !== wallet) continue;

      const trade = parseDexScreenerPnlTrade(log);
      if (trade) tradeMap.set(trade.key, trade);
    }

    if (!blockNumbers.length) {
      exhaustedHistory = true;
      break;
    }

    const pageOldestBlock = Math.min(...blockNumbers);
    const pageNewestBlock = Math.max(...blockNumbers);
    oldestBlockNumber = oldestBlockNumber == null ? pageOldestBlock : Math.min(oldestBlockNumber, pageOldestBlock);
    newestBlockNumber = newestBlockNumber == null ? pageNewestBlock : Math.max(newestBlockNumber, pageNewestBlock);

    if (beforeBlockNumber != null && pageOldestBlock >= beforeBlockNumber) {
      exhaustedHistory = true;
      break;
    }

    beforeBlockNumber = pageOldestBlock;

    if (logs.length < 100) {
      exhaustedHistory = true;
      break;
    }

    if (pageIndex === PNL_DEXSCREENER_CONFIG.maxPages - 1) {
      hitPageLimit = true;
      break;
    }

    if (PNL_DEXSCREENER_CONFIG.pagePauseMs > 0) {
      await sleep(PNL_DEXSCREENER_CONFIG.pagePauseMs);
    }
  }

  const trades = Array.from(tradeMap.values()).sort((left, right) => left.timestamp - right.timestamp);
  const totals = aggregatePnlDexTrades(trades);

  return {
    ok: true,
    source: "dexscreener",
    wallet,
    totals,
    trades,
    meta: {
      sourceLabel: "DexScreener",
      checkedTransactions: tradeMap.size,
      checkedLogs,
      pageCount,
      reachedListingStart: exhaustedHistory,
      exhaustedHistory,
      hitPageLimit,
      oldestTimestamp,
      oldestBlockNumber,
      newestBlockNumber,
      cached: false,
      updatedAt: new Date().toISOString()
    }
  };
}

function buildMvxPnlTransfersUrl(account, pageIndex, params = {}) {
  const url = new URL(`${PNL_MVX_CONFIG.apiBase}/accounts/${account}/transfers`);
  url.searchParams.set("from", String(pageIndex * PNL_MVX_CONFIG.pageSize));
  url.searchParams.set("size", String(PNL_MVX_CONFIG.pageSize));
  url.searchParams.set("status", "success");
  url.searchParams.set("withOperations", "true");
  url.searchParams.set("order", "desc");

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function fetchMvxPnlSource(account, params, maxPages) {
  const transfers = [];
  let hitPageLimit = false;
  let exhaustedHistory = false;
  let oldestTimestamp = null;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await fetchAnalyticsJson(buildMvxPnlTransfersUrl(account, pageIndex, params), PNL_MVX_CONFIG.maxAttempts);
    if (!Array.isArray(page) || !page.length) {
      exhaustedHistory = true;
      break;
    }

    transfers.push(...page);

    const pageTimestamps = page
      .map((item) => Number(item?.timestamp))
      .filter((timestamp) => Number.isFinite(timestamp));
    if (pageTimestamps.length) {
      oldestTimestamp = oldestTimestamp == null
        ? Math.min(...pageTimestamps)
        : Math.min(oldestTimestamp, ...pageTimestamps);
    }

    if (page.length < PNL_MVX_CONFIG.pageSize) {
      exhaustedHistory = true;
      break;
    }

    if (pageIndex === maxPages - 1) {
      hitPageLimit = true;
      break;
    }

    if (PNL_MVX_CONFIG.pagePauseMs > 0) {
      await sleep(PNL_MVX_CONFIG.pagePauseMs);
    }
  }

  return {
    transfers,
    hitPageLimit,
    exhaustedHistory,
    oldestTimestamp
  };
}

function normalizePnlOperation(operation) {
  if (operation?.action && operation.action !== "transfer") return null;
  const token = operation?.identifier || operation?.token || (operation?.type === "egld" ? "EGLD" : "");
  if (!token || !operation?.value) return null;
  if (operation?.esdtType && operation.esdtType !== "FungibleESDT") return null;

  const decimals = Number(operation.decimals ?? (
    token === VOLUME_CONFIG.quoteTokenAddress ? 6 : 18
  ));
  const amount = decimalStringToNumber(String(operation.value), decimals);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const valueUsd = token === VOLUME_CONFIG.quoteTokenAddress
    ? amount
    : Number(operation.valueUSD);

  return {
    token,
    amount,
    valueUsd,
    sender: operation.sender || "",
    receiver: operation.receiver || "",
    key: [
      operation.id || "",
      operation.action || "",
      operation.type || "",
      token,
      operation.sender || "",
      operation.receiver || "",
      String(operation.value || "")
    ].join("|")
  };
}

function groupPnlTransfers(transfers) {
  const groups = new Map();

  for (const entry of Array.isArray(transfers) ? transfers : []) {
    if (entry?.status && entry.status !== "success") continue;
    const hash = String(entry?.originalTxHash || entry?.txHash || "");
    if (!hash) continue;

    let group = groups.get(hash);
    const timestamp = Number(entry.timestamp) || 0;
    if (!group) {
      group = {
        hash,
        timestamp,
        entries: []
      };
      groups.set(hash, group);
    } else if (timestamp && (!group.timestamp || timestamp < group.timestamp)) {
      group.timestamp = timestamp;
    }

    group.entries.push(entry);
  }

  return groups;
}

function normalizePnlTradeTransfer(transfer) {
  const token = transfer?.token || transfer?.identifier || "";
  if (!token || !transfer?.value) return null;
  const decimals = Number(transfer.decimals ?? (
    token === VOLUME_CONFIG.quoteTokenAddress ? 6 : 18
  ));
  const amount = decimalStringToNumber(String(transfer.value), decimals);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { token, amount };
}

function parsePnlPairActionTrades(transfers, wallet) {
  const groupedSwaps = new Map();

  for (const entry of Array.isArray(transfers) ? transfers : []) {
    if (entry?.status && entry.status !== "success") continue;

    const transferList = entry?.action?.arguments?.transfers;
    if (!Array.isArray(transferList) || !transferList.length) continue;

    const primaryTransfer = normalizePnlTradeTransfer(transferList[0]);
    if (!primaryTransfer) continue;

    const timestamp = Number(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;

    const hash = String(entry.originalTxHash || entry.txHash || "");
    if (!hash) continue;

    let groupedSwap = groupedSwaps.get(hash);
    if (!groupedSwap) {
      groupedSwap = {
        hash,
        timestamp,
        inputToken: null,
        inputAmount: 0,
        outputToken: null,
        outputAmount: 0,
        invalid: false
      };
      groupedSwaps.set(hash, groupedSwap);
    } else if (timestamp < groupedSwap.timestamp) {
      groupedSwap.timestamp = timestamp;
    }

    const isSwapInput =
      entry.sender === wallet &&
      entry.receiver === VOLUME_CONFIG.pairAddress &&
      (/^swap/i.test(String(entry.function || "")) || entry?.action?.name === "swap");

    if (isSwapInput) {
      if (groupedSwap.inputToken && groupedSwap.inputToken !== primaryTransfer.token) {
        groupedSwap.invalid = true;
        continue;
      }
      groupedSwap.inputToken = primaryTransfer.token;
      groupedSwap.inputAmount += primaryTransfer.amount;
      continue;
    }

    const isPairOutput =
      entry.sender === VOLUME_CONFIG.pairAddress &&
      entry.receiver === wallet &&
      entry.function !== "depositSwapFees" &&
      (primaryTransfer.token === VOLUME_CONFIG.baseTokenAddress || primaryTransfer.token === VOLUME_CONFIG.quoteTokenAddress);

    if (!isPairOutput) continue;

    if (groupedSwap.outputToken && groupedSwap.outputToken !== primaryTransfer.token) {
      groupedSwap.invalid = true;
      continue;
    }

    groupedSwap.outputToken = primaryTransfer.token;
    groupedSwap.outputAmount += primaryTransfer.amount;
  }

  const trades = [];
  for (const groupedSwap of groupedSwaps.values()) {
    if (groupedSwap.invalid) continue;
    if (!groupedSwap.inputToken || !groupedSwap.outputToken || groupedSwap.inputAmount <= 0 || groupedSwap.outputAmount <= 0) continue;

    let side = "";
    let tclAmount = 0;
    let volumeUsd = 0;

    if (groupedSwap.inputToken === VOLUME_CONFIG.quoteTokenAddress && groupedSwap.outputToken === VOLUME_CONFIG.baseTokenAddress) {
      side = "buy";
      tclAmount = groupedSwap.outputAmount;
      volumeUsd = groupedSwap.inputAmount;
    } else if (groupedSwap.inputToken === VOLUME_CONFIG.baseTokenAddress && groupedSwap.outputToken === VOLUME_CONFIG.quoteTokenAddress) {
      side = "sell";
      tclAmount = groupedSwap.inputAmount;
      volumeUsd = groupedSwap.outputAmount;
    }

    if (!side || !Number.isFinite(tclAmount) || tclAmount <= 0 || !Number.isFinite(volumeUsd) || volumeUsd <= 0) continue;
    trades.push({
      hash: groupedSwap.hash,
      timestamp: groupedSwap.timestamp,
      side,
      tclAmount,
      volumeUsd,
      price: volumeUsd / tclAmount,
      description: "MultiversX pair transfer"
    });
  }

  return trades;
}

function parsePnlOperationTrades(transfers, wallet) {
  const trades = [];

  for (const group of groupPnlTransfers(transfers).values()) {
    const seenOperations = new Set();
    const operations = [];

    for (const entry of group.entries) {
      if (!Array.isArray(entry.operations)) continue;
      for (const rawOperation of entry.operations) {
        const operation = normalizePnlOperation(rawOperation);
        if (!operation || seenOperations.has(operation.key)) continue;
        seenOperations.add(operation.key);
        operations.push(operation);
      }
    }

    if (!operations.length) continue;

    const tclSent = operations
      .filter((operation) => operation.token === VOLUME_CONFIG.baseTokenAddress && operation.sender === wallet)
      .reduce((sum, operation) => sum + operation.amount, 0);
    const tclReceived = operations
      .filter((operation) => operation.token === VOLUME_CONFIG.baseTokenAddress && operation.receiver === wallet)
      .reduce((sum, operation) => sum + operation.amount, 0);
    const usdSent = operations
      .filter((operation) => operation.token !== VOLUME_CONFIG.baseTokenAddress && operation.sender === wallet && Number.isFinite(operation.valueUsd))
      .reduce((sum, operation) => sum + operation.valueUsd, 0);
    const usdReceived = operations
      .filter((operation) => operation.token !== VOLUME_CONFIG.baseTokenAddress && operation.receiver === wallet && Number.isFinite(operation.valueUsd))
      .reduce((sum, operation) => sum + operation.valueUsd, 0);
    const tclSentUsd = operations
      .filter((operation) => operation.token === VOLUME_CONFIG.baseTokenAddress && operation.sender === wallet && Number.isFinite(operation.valueUsd))
      .reduce((sum, operation) => sum + operation.valueUsd, 0);
    const tclReceivedUsd = operations
      .filter((operation) => operation.token === VOLUME_CONFIG.baseTokenAddress && operation.receiver === wallet && Number.isFinite(operation.valueUsd))
      .reduce((sum, operation) => sum + operation.valueUsd, 0);
    const hasNonTclSent = operations
      .some((operation) => operation.token !== VOLUME_CONFIG.baseTokenAddress && operation.sender === wallet);
    const hasNonTclReceived = operations
      .some((operation) => operation.token !== VOLUME_CONFIG.baseTokenAddress && operation.receiver === wallet);
    const pairInvolved = group.entries
      .some((entry) => entry.sender === VOLUME_CONFIG.pairAddress || entry.receiver === VOLUME_CONFIG.pairAddress)
      || operations.some((operation) => operation.sender === VOLUME_CONFIG.pairAddress || operation.receiver === VOLUME_CONFIG.pairAddress);

    const netTcl = tclReceived - tclSent;
    const netUsd = usdReceived - usdSent;
    const buyFallbackUsd = (hasNonTclSent || pairInvolved) && tclReceivedUsd > 0 ? tclReceivedUsd : 0;
    const sellFallbackUsd = (hasNonTclReceived || pairInvolved) && tclSentUsd > 0 ? tclSentUsd : 0;
    let side = "";
    let tclAmount = 0;
    let volumeUsd = 0;

    if (netTcl > 0 && netUsd < 0) {
      side = "buy";
      tclAmount = netTcl;
      volumeUsd = Math.abs(netUsd);
    } else if (netTcl < 0 && netUsd > 0) {
      side = "sell";
      tclAmount = Math.abs(netTcl);
      volumeUsd = netUsd;
    } else if (netTcl > 0 && buyFallbackUsd > 0) {
      side = "buy";
      tclAmount = netTcl;
      volumeUsd = buyFallbackUsd;
    } else if (netTcl < 0 && sellFallbackUsd > 0) {
      side = "sell";
      tclAmount = Math.abs(netTcl);
      volumeUsd = sellFallbackUsd;
    } else if (tclReceived > 0 && usdSent > 0) {
      side = "buy";
      tclAmount = tclReceived;
      volumeUsd = usdSent;
    } else if (tclSent > 0 && usdReceived > 0) {
      side = "sell";
      tclAmount = tclSent;
      volumeUsd = usdReceived;
    }

    if (!side || !Number.isFinite(tclAmount) || tclAmount <= 0 || !Number.isFinite(volumeUsd) || volumeUsd <= 0) continue;
    trades.push({
      hash: group.hash,
      timestamp: group.timestamp,
      side,
      tclAmount,
      volumeUsd,
      price: volumeUsd / tclAmount,
      description: "MultiversX wallet operations"
    });
  }

  return trades;
}

function parseFilteredPnlTrades(transfers, wallet) {
  const merged = new Map();
  for (const trade of parsePnlPairActionTrades(transfers, wallet)) {
    merged.set(trade.hash, trade);
  }
  for (const trade of parsePnlOperationTrades(transfers, wallet)) {
    merged.set(trade.hash, trade);
  }
  return Array.from(merged.values()).sort((left, right) => left.timestamp - right.timestamp);
}

async function fetchMultiversXFilteredPnl(wallet, warnings = []) {
  const sources = [
    {
      label: "TCL wallet transfers",
      account: wallet,
      params: { token: VOLUME_CONFIG.baseTokenAddress },
      maxPages: PNL_MVX_CONFIG.tokenMaxPages
    },
    {
      label: "wallet to TCL/USDC pair",
      account: wallet,
      params: { receiver: VOLUME_CONFIG.pairAddress },
      maxPages: PNL_MVX_CONFIG.pairMaxPages
    },
    {
      label: "TCL/USDC pair to wallet",
      account: wallet,
      params: { sender: VOLUME_CONFIG.pairAddress },
      maxPages: PNL_MVX_CONFIG.pairMaxPages
    }
  ];
  const transferMap = new Map();
  let hitPageLimit = false;
  let exhaustedHistory = true;
  let oldestTimestamp = null;
  const sourceMeta = [];

  for (const source of sources) {
    const result = await fetchMvxPnlSource(source.account, source.params, source.maxPages);
    sourceMeta.push({
      label: source.label,
      transfers: result.transfers.length,
      hitPageLimit: result.hitPageLimit,
      exhaustedHistory: result.exhaustedHistory,
      oldestTimestamp: result.oldestTimestamp
    });
    hitPageLimit = hitPageLimit || result.hitPageLimit;
    exhaustedHistory = exhaustedHistory && result.exhaustedHistory;
    if (result.oldestTimestamp != null) {
      oldestTimestamp = oldestTimestamp == null
        ? result.oldestTimestamp
        : Math.min(oldestTimestamp, result.oldestTimestamp);
    }

    result.transfers.forEach((entry, index) => {
      const key = [
        entry?.txHash || entry?.originalTxHash || index,
        entry?.type || "",
        entry?.sender || "",
        entry?.receiver || "",
        entry?.timestamp || ""
      ].join("|");
      transferMap.set(key, entry);
    });
  }

  const transfers = Array.from(transferMap.values());
  const trades = parseFilteredPnlTrades(transfers, wallet);
  const totals = aggregatePnlDexTrades(trades);

  return {
    ok: true,
    source: "multiversx-filtered",
    wallet,
    totals,
    meta: {
      sourceLabel: "MultiversX filtered",
      checkedTransactions: trades.length,
      checkedTransfers: transfers.length,
      sourceMeta,
      reachedListingStart: !hitPageLimit,
      exhaustedHistory,
      hitPageLimit,
      oldestTimestamp,
      cached: false,
      warnings,
      updatedAt: new Date().toISOString()
    }
  };
}

function isVolumeCoveredMonth(year, monthIndex, startDate, endDate) {
  const startYear = startDate.getUTCFullYear();
  const startMonth = startDate.getUTCMonth();
  const endYear = endDate.getUTCFullYear();
  const endMonth = endDate.getUTCMonth();

  if (year < startYear || year > endYear) return false;
  if (year === startYear && monthIndex < startMonth) return false;
  if (year === endYear && monthIndex > endMonth) return false;
  return true;
}

function createVolumeCoverageRows(startDate, endDate) {
  const rows = [];
  for (let year = endDate.getUTCFullYear(); year >= startDate.getUTCFullYear(); year -= 1) {
    rows.push({
      label: String(year),
      cells: Array.from({ length: 12 }, (_item, monthIndex) => (
        isVolumeCoveredMonth(year, monthIndex, startDate, endDate) ? 0 : null
      ))
    });
  }
  return rows;
}

function buildVolumeSummaryRow(rows, label = "Total") {
  const cells = Array.from({ length: 12 }, (_item, monthIndex) => {
    let hasCoverage = false;
    let sum = 0;

    for (const row of rows) {
      const cell = row.cells[monthIndex];
      if (cell != null) {
        hasCoverage = true;
        sum += cell;
      }
    }

    return hasCoverage ? sum : null;
  });

  return { label, cells };
}

function countVolumeCoveredMonths(rows) {
  let count = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell != null) count += 1;
    }
  }
  return count;
}

function findVolumePeakMonth(rows) {
  let peak = null;
  for (const row of rows) {
    const year = Number(row.label);
    for (let monthIndex = 0; monthIndex < row.cells.length; monthIndex += 1) {
      const value = row.cells[monthIndex];
      if (value == null) continue;
      if (peak == null || value > peak.value) {
        peak = { year, monthIndex, value };
      }
    }
  }
  return peak;
}

function sumVolumeMatrixValues(rows) {
  let total = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (typeof cell === "number" && !Number.isNaN(cell)) total += cell;
    }
  }
  return total;
}

function aggregateVolumeTrades(trades, fetchMeta) {
  const startDate = new Date(VOLUME_CONFIG.listingDate);
  const endDate = new Date();
  const buyRows = createVolumeCoverageRows(startDate, endDate);
  const sellRows = createVolumeCoverageRows(startDate, endDate);
  const totalRows = createVolumeCoverageRows(startDate, endDate);
  const buyMap = new Map(buyRows.map((row) => [row.label, row]));
  const sellMap = new Map(sellRows.map((row) => [row.label, row]));
  const totalMap = new Map(totalRows.map((row) => [row.label, row]));

  let buyTrades = 0;
  let sellTrades = 0;
  let totalTclAmount = 0;
  let oldestTrade = null;
  let latestTrade = null;
  let largestTclTrade = null;

  for (const trade of Array.isArray(trades) ? trades : []) {
    if (!Number.isFinite(trade.timestamp) || !Number.isFinite(trade.volumeUsd) || trade.volumeUsd < 0) continue;

    const tradeDate = new Date(trade.timestamp * 1000);
    const yearKey = String(tradeDate.getUTCFullYear());
    const monthIndex = tradeDate.getUTCMonth();
    const totalRow = totalMap.get(yearKey);
    const buyRow = buyMap.get(yearKey);
    const sellRow = sellMap.get(yearKey);

    if (totalRow && totalRow.cells[monthIndex] != null) {
      totalRow.cells[monthIndex] += trade.volumeUsd;
    }

    if (trade.side === "buy") {
      buyTrades += 1;
      if (buyRow && buyRow.cells[monthIndex] != null) {
        buyRow.cells[monthIndex] += trade.volumeUsd;
      }
    } else if (trade.side === "sell") {
      sellTrades += 1;
      if (sellRow && sellRow.cells[monthIndex] != null) {
        sellRow.cells[monthIndex] += trade.volumeUsd;
      }
    }

    if (Number.isFinite(trade.tclAmount) && trade.tclAmount > 0) {
      totalTclAmount += trade.tclAmount;
      if (!largestTclTrade || trade.tclAmount > largestTclTrade.tclAmount) {
        largestTclTrade = trade;
      }
    }

    if (!oldestTrade || trade.timestamp < oldestTrade.timestamp) {
      oldestTrade = trade;
    }

    if (!latestTrade || trade.timestamp > latestTrade.timestamp) {
      latestTrade = trade;
    }
  }

  return rebuildVolumeAggregatedDerivedState({
    version: 2,
    buyRows,
    sellRows,
    totalRows,
    buyTrades,
    sellTrades,
    totalTclAmount,
    largestTclTrade,
    oldestTrade,
    latestTrade,
    fetchMeta
  });
}

function expandVolumeRowsToEndDate(rows, endDate) {
  const normalizedEndDate = endDate instanceof Date ? endDate : new Date();
  const freshRows = createVolumeCoverageRows(new Date(VOLUME_CONFIG.listingDate), normalizedEndDate);
  const existingMap = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [String(row.label), Array.isArray(row.cells) ? row.cells : []])
  );

  for (const freshRow of freshRows) {
    const existingCells = existingMap.get(String(freshRow.label));
    if (!existingCells) continue;
    for (let monthIndex = 0; monthIndex < freshRow.cells.length; monthIndex += 1) {
      if (existingCells[monthIndex] !== undefined) {
        freshRow.cells[monthIndex] = existingCells[monthIndex];
      }
    }
  }

  return freshRows;
}

function rebuildVolumeAggregatedDerivedState(aggregated) {
  aggregated.totalVolume = sumVolumeMatrixValues(aggregated.totalRows);
  aggregated.buyVolume = sumVolumeMatrixValues(aggregated.buyRows);
  aggregated.sellVolume = sumVolumeMatrixValues(aggregated.sellRows);
  aggregated.coveredMonths = countVolumeCoveredMonths(aggregated.totalRows);
  aggregated.averageMonthlyVolume = aggregated.coveredMonths > 0 ? aggregated.totalVolume / aggregated.coveredMonths : 0;
  aggregated.buySummary = buildVolumeSummaryRow(aggregated.buyRows, "Total");
  aggregated.sellSummary = buildVolumeSummaryRow(aggregated.sellRows, "Total");
  aggregated.totalSummary = buildVolumeSummaryRow(aggregated.totalRows, "Total");
  aggregated.peakBuyMonth = findVolumePeakMonth(aggregated.buyRows);
  aggregated.peakSellMonth = findVolumePeakMonth(aggregated.sellRows);
  aggregated.peakTotalMonth = findVolumePeakMonth(aggregated.totalRows);
  aggregated.buyDominancePct = aggregated.totalVolume > 0 ? (aggregated.buyVolume / aggregated.totalVolume) * 100 : 0;
  aggregated.sellDominancePct = aggregated.totalVolume > 0 ? (aggregated.sellVolume / aggregated.totalVolume) * 100 : 0;
  aggregated.totalTrades = (Number(aggregated.buyTrades) || 0) + (Number(aggregated.sellTrades) || 0);
  return aggregated;
}

function normalizeVolumeAggregatedSnapshot(aggregated, endDate = new Date()) {
  const cloned = cloneJson(aggregated);
  cloned.buyRows = expandVolumeRowsToEndDate(cloned.buyRows, endDate);
  cloned.sellRows = expandVolumeRowsToEndDate(cloned.sellRows, endDate);
  cloned.totalRows = expandVolumeRowsToEndDate(cloned.totalRows, endDate);
  return rebuildVolumeAggregatedDerivedState(cloned);
}

function mergeVolumeTradesIntoAggregated(baseAggregated, trades, fetchMeta) {
  const aggregated = normalizeVolumeAggregatedSnapshot(baseAggregated, new Date());
  const buyMap = new Map(aggregated.buyRows.map((row) => [row.label, row]));
  const sellMap = new Map(aggregated.sellRows.map((row) => [row.label, row]));
  const totalMap = new Map(aggregated.totalRows.map((row) => [row.label, row]));

  aggregated.buyTrades = Number(aggregated.buyTrades) || 0;
  aggregated.sellTrades = Number(aggregated.sellTrades) || 0;
  aggregated.totalTclAmount = Number(aggregated.totalTclAmount) || 0;

  for (const trade of Array.isArray(trades) ? trades : []) {
    if (!Number.isFinite(trade.timestamp) || !Number.isFinite(trade.volumeUsd) || trade.volumeUsd < 0) continue;

    const tradeDate = new Date(trade.timestamp * 1000);
    const yearKey = String(tradeDate.getUTCFullYear());
    const monthIndex = tradeDate.getUTCMonth();
    const totalRow = totalMap.get(yearKey);
    const buyRow = buyMap.get(yearKey);
    const sellRow = sellMap.get(yearKey);

    if (totalRow) {
      totalRow.cells[monthIndex] = (Number(totalRow.cells[monthIndex]) || 0) + trade.volumeUsd;
    }

    if (trade.side === "buy") {
      aggregated.buyTrades += 1;
      if (buyRow) {
        buyRow.cells[monthIndex] = (Number(buyRow.cells[monthIndex]) || 0) + trade.volumeUsd;
      }
    } else if (trade.side === "sell") {
      aggregated.sellTrades += 1;
      if (sellRow) {
        sellRow.cells[monthIndex] = (Number(sellRow.cells[monthIndex]) || 0) + trade.volumeUsd;
      }
    }

    if (Number.isFinite(trade.tclAmount) && trade.tclAmount > 0) {
      aggregated.totalTclAmount += trade.tclAmount;
      if (!aggregated.largestTclTrade || trade.tclAmount > aggregated.largestTclTrade.tclAmount) {
        aggregated.largestTclTrade = cloneJson(trade);
      }
    }

    if (!aggregated.oldestTrade || trade.timestamp < aggregated.oldestTrade.timestamp) {
      aggregated.oldestTrade = cloneJson(trade);
    }

    if (!aggregated.latestTrade || trade.timestamp > aggregated.latestTrade.timestamp) {
      aggregated.latestTrade = cloneJson(trade);
    }
  }

  aggregated.fetchMeta = {
    ...(aggregated.fetchMeta || {}),
    ...(fetchMeta || {})
  };

  return rebuildVolumeAggregatedDerivedState(aggregated);
}

async function refreshAnalyticsIfDue(env) {
  const kv = requireKv(env);
  const current = await readAnalyticsSnapshot(kv);
  if (current && !isAnalyticsSnapshotDue(current, env)) return current;
  return refreshAnalyticsSnapshot(env, { current });
}

async function refreshAnalyticsSnapshot(env, options = {}) {
  const kv = requireKv(env);
  const current = options.current || await readAnalyticsSnapshot(kv);
  if (!options.force && current && !isAnalyticsSnapshotDue(current, env)) return current;

  let locked = true;
  if (!options.force) {
    locked = await reserveAnalyticsRefreshLock(kv);
    if (!locked) return current;
  }

  try {
    const snapshot = await buildAnalyticsSnapshot();
    await kv.put(ANALYTICS_SNAPSHOT_KEY, JSON.stringify(snapshot));
    return snapshot;
  } finally {
    if (!options.force && locked) {
      await kv.delete(ANALYTICS_REFRESH_LOCK_KEY).catch(() => {});
    }
  }
}

async function readAnalyticsSnapshot(kv) {
  const snapshot = await kv.get(ANALYTICS_SNAPSHOT_KEY, "json").catch(() => null);
  return snapshot && snapshot.meta ? snapshot : null;
}

async function reserveAnalyticsRefreshLock(kv) {
  const existing = await kv.get(ANALYTICS_REFRESH_LOCK_KEY);
  if (existing) return false;
  await kv.put(ANALYTICS_REFRESH_LOCK_KEY, String(Date.now()), {
    expirationTtl: ANALYTICS_REFRESH_LOCK_TTL_SECONDS
  });
  return true;
}

function isAnalyticsSnapshotDue(snapshot, env) {
  const updatedAt = snapshot?.meta?.updatedAt ? new Date(snapshot.meta.updatedAt).getTime() : 0;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return true;
  return Date.now() - updatedAt >= analyticsRefreshIntervalMs(env);
}

function analyticsRefreshIntervalMs(env) {
  const minutes = Number(env.ANALYTICS_REFRESH_INTERVAL_MINUTES || DEFAULT_ANALYTICS_REFRESH_INTERVAL_MINUTES);
  const safeMinutes = Number.isFinite(minutes) ? Math.min(24 * 60, Math.max(5, minutes)) : DEFAULT_ANALYTICS_REFRESH_INTERVAL_MINUTES;
  return safeMinutes * 60 * 1000;
}

async function buildAnalyticsSnapshot() {
  const [coinPayload, quarterlyPayload, monthlyPayload] = await Promise.all([
    fetchAnalyticsJson(ANALYTICS_ENDPOINTS.coin),
    fetchAnalyticsJson(ANALYTICS_ENDPOINTS.quarterly),
    fetchAnalyticsJson(ANALYTICS_ENDPOINTS.monthly)
  ]);

  const coin = coinPayload?.data || {};
  const quarterlyData = Array.isArray(quarterlyPayload?.data) ? quarterlyPayload.data : [];
  const monthlyData = monthlyPayload?.data || {};
  const currentPrice = numberOrNull(coin?.price?.USD);

  const performance = [
    { label: "1W", key: "7D" },
    { label: "1M", key: "30D" },
    { label: "3M", key: "3M" },
    { label: "6M", key: "6M" },
    { label: "YTD", key: "YTD" },
    { label: "1Y", key: "1Y" }
  ].map((metric) => {
    const startPrice = numberOrNull(coin?.histPrices?.[metric.key]?.USD);
    const high = numberOrNull(coin?.histData?.high?.[metric.key]?.USD);
    const low = numberOrNull(coin?.histData?.low?.[metric.key]?.USD);
    const change = currentPrice !== null && startPrice !== null && startPrice !== 0
      ? roundNumber(currentPrice - startPrice, 12)
      : null;

    return {
      label: metric.label,
      key: metric.key,
      startPrice,
      currentPrice,
      change,
      changePct: getPercentChange(startPrice, currentPrice),
      high,
      low
    };
  });

  const quarterColumns = ["Q1", "Q2", "Q3", "Q4"];
  const sortedQuarterlyData = [...quarterlyData].sort((left, right) => Number(right?.year) - Number(left?.year));

  const quarterlyReturnsRows = sortedQuarterlyData.map((entry) => newMatrixRow(
    String(entry?.year || ""),
    [1, 2, 3, 4].map((quarterIndex) => {
      const quarter = entry?.[`q${quarterIndex}`];
      if (!quarter) return null;
      return getPercentChange(numberOrNull(quarter.openUSD), numberOrNull(quarter.closeUSD));
    })
  ));

  const quarterlyClosingRows = sortedQuarterlyData.map((entry) => newMatrixRow(
    String(entry?.year || ""),
    [1, 2, 3, 4].map((quarterIndex) => {
      const quarter = entry?.[`q${quarterIndex}`];
      if (!quarter || !quarter.isFull) return null;
      return numberOrNull(quarter.closeUSD);
    })
  ));

  const monthColumns = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthValuesByIndex = Array.from({ length: 13 }, () => []);
  const monthlyRows = Object.keys(monthlyData)
    .sort((left, right) => Number(right) - Number(left))
    .map((year) => {
      const yearMonths = monthlyData?.[year]?.months || {};
      const cells = monthColumns.map((_month, index) => {
        const monthIndex = index + 1;
        const monthEntry = yearMonths?.[monthIndex] || yearMonths?.[String(monthIndex)];
        if (!monthEntry) return null;

        const changePct = getPercentChange(numberOrNull(monthEntry.openUSD), numberOrNull(monthEntry.closeUSD));
        if (changePct !== null) monthValuesByIndex[monthIndex].push(changePct);
        return changePct;
      });

      return newMatrixRow(String(year), cells);
    });

  const averageCells = monthColumns.map((_month, index) => getAverage(monthValuesByIndex[index + 1]));
  const medianCells = monthColumns.map((_month, index) => getMedian(monthValuesByIndex[index + 1]));

  return {
    meta: {
      updatedAt: new Date().toISOString(),
      source: "CryptoRank",
      endpoints: ANALYTICS_ENDPOINTS
    },
    coin: {
      name: String(coin?.name || ""),
      symbol: String(coin?.symbol || ""),
      key: String(coin?.key || ""),
      image: {
        x60: String(coin?.image?.x60 || ""),
        x150: String(coin?.image?.x150 || "")
      }
    },
    market: {
      currentPriceUsd: currentPrice,
      marketCapUsd: numberOrNull(coin?.marketCap),
      volume24hUsd: numberOrNull(coin?.volume24h),
      athPriceUsd: numberOrNull(coin?.athPrice?.USD),
      atlPriceUsd: numberOrNull(coin?.atlPrice?.USD),
      listingDate: String(coin?.listingDate || ""),
      historyStartDay: String(coin?.historyStartDay || ""),
      historyEndDay: String(coin?.historyEndDay || "")
    },
    performance,
    quarterlyReturns: {
      columns: quarterColumns,
      rows: quarterlyReturnsRows
    },
    quarterlyClosing: {
      columns: quarterColumns,
      rows: quarterlyClosingRows
    },
    monthlyReturns: {
      columns: monthColumns,
      rows: monthlyRows,
      summary: [
        newMatrixRow("Average", averageCells),
        newMatrixRow("Median", medianCells)
      ]
    }
  };
}

async function fetchAnalyticsJson(url, maxAttempts = 4) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "TCLExplorerAnalyticsSync/1.0"
        },
        cache: "no-store"
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload) throw new Error("Empty analytics response");
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await sleep(1500 * attempt);
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError?.message || "unknown error"}`);
}

function newMatrixRow(label, cells) {
  return { label, cells };
}

function getPercentChange(open, close) {
  const openValue = numberOrNull(open);
  const closeValue = numberOrNull(close);
  if (openValue === null || closeValue === null || openValue === 0) return null;
  return roundNumber(((closeValue / openValue) - 1) * 100, 8);
}

function getAverage(values) {
  const safeValues = values.filter(Number.isFinite);
  if (!safeValues.length) return null;
  const total = safeValues.reduce((sum, value) => sum + value, 0);
  return roundNumber(total / safeValues.length, 2);
}

function getMedian(values) {
  const safeValues = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!safeValues.length) return null;
  const middle = Math.floor(safeValues.length / 2);
  if (safeValues.length % 2 === 1) return roundNumber(safeValues[middle], 2);
  return roundNumber((safeValues[middle - 1] + safeValues[middle]) / 2, 2);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundNumber(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function dispatchDueNotifications(env, options = {}) {
  const startedAt = new Date();
  let kv;
  let report;

  try {
    kv = requireKv(env);
    const subscriptions = await listSubscriptions(kv);
    const events = await loadEvents(env);
    const now = new Date();
    report = {
      ok: true,
      source: options.source || "unknown",
      checked: subscriptions.length,
      due: 0,
      sent: 0,
      skipped: 0,
      invalid: 0,
      errors: 0,
      startedAt: startedAt.toISOString()
    };

    for (const record of subscriptions) {
      const dueItems = dueNotificationsForRecord(record, events, now, env);
      report.due += dueItems.length;

      for (const item of dueItems) {
        const sentKey = `${SENT_PREFIX}${item.sentKey}`;
        const reserved = await reserveSentKey(kv, sentKey);
        if (!reserved) {
          report.skipped += 1;
          continue;
        }

        try {
          await sendWebPush(record.subscription, item.payload, env);
          report.sent += 1;
        } catch (error) {
          if (error.status === 404 || error.status === 410) {
            const subscriptionKey = `${SUBSCRIPTION_PREFIX}${record.id}`;
            const existed = await kv.get(subscriptionKey);
            await kv.delete(subscriptionKey);
            if (existed) {
              await adjustSubscriberCount(kv, -1);
            }
            report.invalid += 1;
          } else {
            await kv.delete(sentKey);
            report.errors += 1;
          }
        }
      }
    }

    report.finishedAt = new Date().toISOString();
    await writeLastDispatch(kv, report).catch(() => {});
    return report;
  } catch (error) {
    if (kv) {
      await writeLastDispatch(kv, {
        ok: false,
        source: options.source || "unknown",
        checked: report?.checked || 0,
        due: report?.due || 0,
        sent: report?.sent || 0,
        skipped: report?.skipped || 0,
        invalid: report?.invalid || 0,
        errors: (report?.errors || 0) + 1,
        error: error?.message || "Dispatch failed",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString()
      }).catch(() => {});
    }
    throw error;
  }
}

async function dispatchDueClaimReminders(env, options = {}) {
  const startedAt = new Date();
  let kv;
  let report;

  try {
    kv = requireKv(env);
    const reminders = await listClaimReminderRecords(kv);
    const now = new Date();
    report = {
      ok: true,
      source: options.source || "unknown",
      checked: reminders.length,
      due: 0,
      sent: 0,
      skipped: 0,
      invalid: 0,
      errors: 0,
      startedAt: startedAt.toISOString()
    };

    for (const record of reminders) {
      const dueItems = dueClaimRemindersForRecord(record, now, env);
      report.due += dueItems.length;

      for (const item of dueItems) {
        const sentKey = `${CLAIM_SENT_PREFIX}${item.sentKey}`;
        const reserved = await reserveSentKey(kv, sentKey, CLAIM_SENT_TTL_SECONDS);
        if (!reserved) {
          report.skipped += 1;
          continue;
        }

        try {
          await sendWebPush(record.subscription, item.payload, env);
          report.sent += 1;
        } catch (error) {
          if (error.status === 404 || error.status === 410) {
            const reminderKey = `${CLAIM_REMINDER_PREFIX}${record.id}`;
            const existed = await kv.get(reminderKey);
            await kv.delete(reminderKey);
            if (existed) {
              await adjustClaimReminderCount(kv, -1);
            }
            report.invalid += 1;
          } else {
            await kv.delete(sentKey);
            report.errors += 1;
          }
        }
      }
    }

    report.finishedAt = new Date().toISOString();
    await writeClaimReminderLastDispatch(kv, report).catch(() => {});
    return report;
  } catch (error) {
    if (kv) {
      await writeClaimReminderLastDispatch(kv, {
        ok: false,
        source: options.source || "unknown",
        checked: report?.checked || 0,
        due: report?.due || 0,
        sent: report?.sent || 0,
        skipped: report?.skipped || 0,
        invalid: report?.invalid || 0,
        errors: (report?.errors || 0) + 1,
        error: error?.message || "Claim reminder dispatch failed",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString()
      }).catch(() => {});
    }
    throw error;
  }
}

async function listClaimReminderRecords(kv) {
  const records = [];
  let cursor;

  do {
    const page = await kv.list({
      prefix: CLAIM_REMINDER_PREFIX,
      cursor
    });

    for (const key of page.keys) {
      const raw = await kv.get(key.name);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw);
        if (record && record.enabled !== false && isValidSubscription(record.subscription)) {
          records.push(record);
        }
      } catch (_) {
        await kv.delete(key.name);
      }
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return records;
}

async function listSubscriptions(kv) {
  const records = [];
  let cursor;

  do {
    const page = await kv.list({
      prefix: SUBSCRIPTION_PREFIX,
      cursor
    });

    for (const key of page.keys) {
      const raw = await kv.get(key.name);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw);
        if (record && isValidSubscription(record.subscription)) records.push(record);
      } catch (_) {
        await kv.delete(key.name);
      }
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return records;
}

async function countSubscriptions(kv) {
  let count = 0;
  let cursor;

  do {
    const page = await kv.list({
      prefix: SUBSCRIPTION_PREFIX,
      cursor
    });
    count += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return count;
}

async function readSubscriberStats(kv) {
  const raw = await kv.get(STATS_KEY, "json").catch(() => null);
  const count = Number(raw?.subscribers);
  return {
    subscribers: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0,
    source: raw ? "counter" : "default"
  };
}

/** Count real subscription keys in KV and sync the cached counter. */
async function reconcileSubscriberCount(kv) {
  const actual = await countSubscriptions(kv);
  await writeSubscriberStats(kv, actual);
  return actual;
}

async function writeSubscriberStats(kv, subscribers) {
  const safeCount = Math.max(0, Math.floor(Number(subscribers) || 0));
  const payload = {
    subscribers: safeCount,
    updatedAt: new Date().toISOString()
  };
  await kv.put(STATS_KEY, JSON.stringify(payload));
  await recordSubscriberStatsHistory(kv, safeCount);
  return safeCount;
}

async function adjustSubscriberCount(kv, delta) {
  const current = await readSubscriberStats(kv);
  return writeSubscriberStats(kv, current.subscribers + Number(delta || 0));
}

async function recordSubscriberStatsHistory(kv, subscribers) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${STATS_HISTORY_PREFIX}${day}`;
  const previous = await kv.get(key, "json").catch(() => null);
  const count = Math.max(0, Math.floor(Number(subscribers) || 0));
  const payload = {
    date: day,
    subscribers: count,
    min: Number.isFinite(Number(previous?.min)) ? Math.min(Number(previous.min), count) : count,
    max: Number.isFinite(Number(previous?.max)) ? Math.max(Number(previous.max), count) : count,
    updatedAt: new Date().toISOString()
  };
  await kv.put(key, JSON.stringify(payload), {
    expirationTtl: 120 * 24 * 60 * 60
  });
}

async function countClaimReminderRecords(kv) {
  let count = 0;
  let cursor;

  do {
    const page = await kv.list({
      prefix: CLAIM_REMINDER_PREFIX,
      cursor
    });
    count += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return count;
}

async function readClaimReminderStats(kv) {
  const raw = await kv.get(CLAIM_STATS_KEY, "json").catch(() => null);
  const count = Number(raw?.reminders);
  return {
    reminders: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0,
    source: raw ? "counter" : "default"
  };
}

async function writeClaimReminderStats(kv, reminders) {
  const safeCount = Math.max(0, Math.floor(Number(reminders) || 0));
  await kv.put(CLAIM_STATS_KEY, JSON.stringify({
    reminders: safeCount,
    updatedAt: new Date().toISOString()
  }));
  return safeCount;
}

async function adjustClaimReminderCount(kv, delta) {
  const current = await readClaimReminderStats(kv);
  return writeClaimReminderStats(kv, current.reminders + Number(delta || 0));
}

async function reconcileClaimReminderCount(kv) {
  const actual = await countClaimReminderRecords(kv);
  await writeClaimReminderStats(kv, actual);
  return actual;
}

async function readLastDispatch(kv) {
  return kv.get(LAST_DISPATCH_KEY, "json");
}

async function writeLastDispatch(kv, payload) {
  await kv.put(LAST_DISPATCH_KEY, JSON.stringify({
    ...payload,
    updatedAt: new Date().toISOString()
  }), {
    expirationTtl: 14 * 24 * 60 * 60
  });
}

async function readClaimReminderLastDispatch(kv) {
  return kv.get(CLAIM_LAST_DISPATCH_KEY, "json");
}

async function writeClaimReminderLastDispatch(kv, payload) {
  await kv.put(CLAIM_LAST_DISPATCH_KEY, JSON.stringify({
    ...payload,
    updatedAt: new Date().toISOString()
  }), {
    expirationTtl: 14 * 24 * 60 * 60
  });
}

async function loadEvents(env) {
  const url = env.EVENTS_URL || DEFAULT_EVENTS_URL;
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Events HTTP ${response.status}`);
  return response.json();
}

function dueNotificationsForRecord(record, eventsData, now, env) {
  const reminderMinutes = resolveReminderMinutes(record.reminderMinutes);
  const lang = normalizeLang(record.lang);
  const templates = EVENT_COPY[lang] || EVENT_COPY.en;
  const lookbackMs = Number(env.EVENT_PUSH_LOOKBACK_MINUTES || 6) * 60 * 1000;
  const nowMs = now.getTime();
  const due = [];

  Object.entries(eventsData || {}).forEach(([day, events]) => {
    (events || []).forEach((event) => {
      const occurrence = getEventOccurrence(day, event, now, lookbackMs);
      if (!occurrence) return;

      const startAt = occurrence.start.getTime();
      const endAt = occurrence.end.getTime();
      const midpointAt = startAt + Math.round((endAt - startAt) / 2);
      const reminderAt = startAt - reminderMinutes * 60 * 1000;
      const actualReminderMinutes = minutesUntil(startAt, nowMs);
      const eventName = event.name || "TCL Event";
      const base = {
        body: event.description || templates.defaultBody,
        url: "index.html#events",
        timestamp: startAt
      };

      [
        {
          type: "reminder",
          triggerAt: reminderAt,
          title: formatTemplate(templates.reminderTitle, { name: eventName, minutes: actualReminderMinutes })
        },
        {
          type: "live",
          triggerAt: startAt,
          title: formatTemplate(templates.liveTitle, { name: eventName })
        },
        {
          type: "midpoint",
          triggerAt: midpointAt,
          title: formatTemplate(templates.midpointTitle, { name: eventName })
        },
        {
          type: "end",
          triggerAt: endAt,
          title: formatTemplate(templates.endTitle, { name: eventName })
        }
      ].forEach((notification) => {
        if (notification.triggerAt > nowMs) return;
        if (notification.triggerAt < nowMs - lookbackMs) return;

        const sentKeySource = [
          record.id,
          day,
          eventName,
          event.start,
          startAt,
          notification.type,
          reminderMinutes
        ].join("|");

        const sentKey = stableHash(sentKeySource);

        due.push({
          sentKey,
          payload: {
            ...base,
            title: notification.title,
            tag: `tcl-event-${sentKey}`,
            renotify: true
          }
        });
      });
    });
  });

  return due;
}

function dueClaimRemindersForRecord(record, now, env) {
  if (!record || record.enabled === false || !isValidSubscription(record.subscription)) return [];

  const expiresAt = Number(record.expiresAt);
  if (!Number.isFinite(expiresAt)) return [];

  const earlyDays = normalizeClaimEarlyDays(record.earlyDays);
  const lang = normalizeLang(record.lang);
  const templates = CLAIM_COPY[lang] || CLAIM_COPY.en;
  const lookbackMs = Number(env.CLAIM_REMINDER_LOOKBACK_MINUTES || env.EVENT_PUSH_LOOKBACK_MINUTES || 6) * 60 * 1000;
  const nowMs = now.getTime();
  const label = normalizeClaimLabel(record.label, templates.defaultLabel);
  const daysLeft = Math.max(0, Math.ceil((expiresAt - nowMs) / DAY_MS));
  const base = {
    body: formatTemplate(templates.earlyBody, { days: daysLeft, label }),
    url: "index.html#claimReminder",
    timestamp: expiresAt
  };
  const due = [];
  const triggers = [];
  const earlyAt = expiresAt - earlyDays * DAY_MS;
  const finalAt = expiresAt - DAY_MS;

  if (earlyDays > 1 && earlyAt < finalAt) {
    triggers.push({
      type: "early",
      triggerAt: earlyAt,
      title: formatTemplate(templates.earlyTitle, { days: daysLeft, label }),
      body: formatTemplate(templates.earlyBody, { days: daysLeft, label })
    });
  }

  triggers.push({
    type: "final",
    triggerAt: finalAt,
    title: formatTemplate(templates.finalTitle, { days: daysLeft, label }),
    body: formatTemplate(templates.finalBody, { days: daysLeft, label })
  });

  triggers.forEach((notification) => {
    if (notification.triggerAt > nowMs) return;
    if (notification.triggerAt < nowMs - lookbackMs) return;

    const sentKeySource = [
      record.id,
      expiresAt,
      notification.type,
      earlyDays
    ].join("|");
    const sentKey = stableHash(sentKeySource);

    due.push({
      sentKey,
      payload: {
        ...base,
        title: notification.title,
        body: notification.body,
        tag: `tcl-claim-${sentKey}`,
        renotify: true
      }
    });
  });

  return due;
}

async function reserveSentKey(kv, key, ttlSeconds = SENT_TTL_SECONDS) {
  const existing = await kv.get(key);
  if (existing) return false;
  await kv.put(key, "1", { expirationTtl: ttlSeconds });
  return true;
}

function getEventOccurrence(day, event, now, lookbackMs = 0) {
  const targetIndex = WEEKDAYS.indexOf(day);
  if (targetIndex < 0 || !event.start || !event.end) return null;

  const [startHour, startMinute] = String(event.start).split(":").map(Number);
  const [endHour, endMinute] = String(event.end).split(":").map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;

  const dayOffset = (targetIndex - getTodayIndex(now) + 7) % 7;
  let start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + dayOffset,
    startHour,
    startMinute
  ));
  let end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + dayOffset,
    endHour,
    endMinute
  ));

  if (end <= start) end = new Date(end.getTime() + DAY_MS);
  if (end.getTime() < now.getTime() - Math.max(0, Number(lookbackMs) || 0)) {
    start = new Date(start.getTime() + 7 * DAY_MS);
    end = new Date(end.getTime() + 7 * DAY_MS);
  }

  return { start, end };
}

function getTodayIndex(date) {
  return (date.getUTCDay() + 6) % 7;
}

function formatTemplate(template, vars) {
  let value = template;
  Object.entries(vars || {}).forEach(([key, replacement]) => {
    value = value.split(`{${key}}`).join(String(replacement));
  });
  return value;
}

function minutesUntil(timestamp, nowMs) {
  return Math.max(0, Math.ceil((timestamp - nowMs) / 60000));
}

function normalizeLang(value) {
  const lang = String(value || "en").toLowerCase().split("-")[0];
  return lang === "ro" ? "ro" : "en";
}

function normalizeReminderMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REMINDER_MINUTES;
  return Math.min(120, Math.max(0, Math.round(parsed)));
}

function resolveReminderMinutes(value) {
  const normalized = normalizeReminderMinutes(value);
  return normalized === LEGACY_DEFAULT_REMINDER_MINUTES ? DEFAULT_REMINDER_MINUTES : normalized;
}

function normalizeClaimDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.min(3650, Math.max(1, Math.round(parsed)));
}

function normalizeClaimEarlyDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return CLAIM_DEFAULT_EARLY_DAYS;
  return Math.min(365, Math.max(1, Math.round(parsed)));
}

function normalizeClaimLabel(value, fallback = "Automatic claim") {
  const label = String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
  return label || fallback;
}

function publicClaimReminderRecord(record) {
  const expiresAt = Number(record?.expiresAt);
  const earlyDays = normalizeClaimEarlyDays(record?.earlyDays);
  const nowMs = Date.now();
  return {
    id: record?.id || "",
    enabled: record?.enabled !== false,
    label: record?.label || "Automatic claim",
    lang: normalizeLang(record?.lang),
    timezone: String(record?.timezone || ""),
    earlyDays,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    expiresAtIso: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : "",
    daysLeft: Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - nowMs) / DAY_MS)) : null,
    nextEarlyAtIso: Number.isFinite(expiresAt) ? new Date(expiresAt - earlyDays * DAY_MS).toISOString() : "",
    finalReminderAtIso: Number.isFinite(expiresAt) ? new Date(expiresAt - DAY_MS).toISOString() : "",
    createdAt: record?.createdAt || "",
    updatedAt: record?.updatedAt || "",
    lastAction: record?.lastAction || "",
    lastInputDays: Number.isFinite(Number(record?.lastInputDays)) ? Number(record.lastInputDays) : null
  };
}

function isValidSubscription(subscription) {
  return Boolean(
    subscription &&
    typeof subscription.endpoint === "string" &&
    subscription.keys &&
    typeof subscription.keys.p256dh === "string" &&
    typeof subscription.keys.auth === "string"
  );
}

async function sendWebPush(subscription, payload, env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error("VAPID keys are not configured");
  }

  const encrypted = await encryptPushPayload(subscription, payload);
  const jwt = await createVapidJwt(subscription.endpoint, env);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(env.EVENT_PUSH_TTL_SECONDS || 3600),
      Urgency: "normal"
    },
    body: encrypted
  });

  if (!response.ok && response.status !== 201) {
    const error = new Error(`Push service HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
}

async function encryptPushPayload(subscription, payload) {
  const receiverPublicKey = base64UrlToUint8Array(subscription.keys.p256dh);
  const authSecret = base64UrlToUint8Array(subscription.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const appServerKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveBits"]
  );

  const appServerPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", appServerKeyPair.publicKey));
  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPublicKey,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    false,
    []
  );

  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: receiverKey
    },
    appServerKeyPair.privateKey,
    256
  ));

  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const keyInfo = concatBytes(
    textBytes("WebPush: info"),
    new Uint8Array([0]),
    receiverPublicKey,
    appServerPublicKey
  );
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, textBytes("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, textBytes("Content-Encoding: nonce\0"), 12);
  const plainPayload = concatBytes(textBytes(JSON.stringify(payload)), new Uint8Array([2]));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    cek,
    {
      name: "AES-GCM"
    },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      tagLength: 128
    },
    cryptoKey,
    plainPayload
  ));

  const recordSize = new Uint8Array([0, 0, 16, 0]);
  return concatBytes(
    salt,
    recordSize,
    new Uint8Array([appServerPublicKey.length]),
    appServerPublicKey,
    ciphertext
  );
}

async function createVapidJwt(endpoint, env) {
  const audience = new URL(endpoint).origin;
  const header = base64UrlEncode(textBytes(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(textBytes(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT || "mailto:admin@thecursedland.com"
  })));
  const unsignedToken = `${header}.${claims}`;
  const signature = await signEs256(unsignedToken, env);
  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function signEs256(value, env) {
  const publicKey = base64UrlToUint8Array(env.VAPID_PUBLIC_KEY);
  if (publicKey.length !== 65 || publicKey[0] !== 4) {
    throw new Error("Invalid VAPID public key");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(publicKey.slice(1, 33)),
      y: base64UrlEncode(publicKey.slice(33, 65)),
      d: env.VAPID_PRIVATE_KEY,
      ext: false
    },
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    key,
    textBytes(value)
  ));

  return signature.length === 64 ? signature : derToJose(signature);
}

function derToJose(signature) {
  let offset = 0;
  if (signature[offset] !== 0x30) throw new Error("Invalid DER signature");
  offset += 2;

  if (signature[offset] !== 0x02) throw new Error("Invalid DER signature");
  let rLength = signature[offset + 1];
  offset += 2;
  if (signature[offset] === 0 && rLength > 32) {
    offset += 1;
    rLength -= 1;
  }
  const r = signature.slice(offset, offset + rLength);
  offset += rLength;

  if (signature[offset] !== 0x02) throw new Error("Invalid DER signature");
  let sLength = signature[offset + 1];
  offset += 2;
  if (signature[offset] === 0 && sLength > 32) {
    offset += 1;
    sLength -= 1;
  }
  const s = signature.slice(offset, offset + sLength);
  return concatBytes(leftPad(r, 32), leftPad(s, 32));
}

function leftPad(bytes, length) {
  if (bytes.length === length) return bytes;
  const padded = new Uint8Array(length);
  padded.set(bytes.slice(Math.max(0, bytes.length - length)), Math.max(0, length - bytes.length));
  return padded;
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function hkdfExpand(prk, info, length) {
  const blocks = [];
  let previous = new Uint8Array(0);
  let outputLength = 0;
  let counter = 1;

  while (outputLength < length) {
    const block = await hmacSha256(prk, concatBytes(previous, info, new Uint8Array([counter])));
    blocks.push(block);
    outputLength += block.length;
    previous = block;
    counter += 1;
  }

  return concatBytes(...blocks).slice(0, length);
}

function concatBytes(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

function base64UrlToUint8Array(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64UrlEncode(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stableHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function subscriptionId(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", textBytes(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
