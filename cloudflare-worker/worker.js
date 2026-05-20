const SUBSCRIPTION_PREFIX = "subscription:";
const SENT_PREFIX = "sent:";
const STATS_KEY = "stats:subscriptions";
const STATS_HISTORY_PREFIX = "stats:history:";
const DEFAULT_REMINDER_MINUTES = 15;
const LEGACY_DEFAULT_REMINDER_MINUTES = 10;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_MS = 24 * 60 * 60 * 1000;
const SENT_TTL_SECONDS = 14 * 24 * 60 * 60;
const DEFAULT_EVENTS_URL = "https://axel4ro.github.io/TCLexplorer/weekly_events.json";
const ANALYTICS_SNAPSHOT_KEY = "analytics:snapshot";
const ANALYTICS_REFRESH_LOCK_KEY = "analytics:refresh-lock";
const ANALYTICS_REFRESH_LOCK_TTL_SECONDS = 4 * 60;
const DEFAULT_ANALYTICS_REFRESH_INTERVAL_MINUTES = 15;
const ANALYTICS_ENDPOINTS = {
  coin: "https://api.cryptorank.io/v0/coins/the-cursed-land",
  quarterly: "https://api.cryptorank.io/v0/coins/the-cursed-land/quarterly-history",
  monthly: "https://api.cryptorank.io/v0/coins/the-cursed-land/monthly-history"
};

const EVENT_COPY = {
  en: {
    reminderTitle: "{name} starts in {minutes} min",
    liveTitle: "{name} is live now",
    defaultBody: "The Cursed Land weekly event"
  },
  ro: {
    reminderTitle: "{name} incepe in {minutes} min",
    liveTitle: "{name} este activ acum",
    defaultBody: "Eveniment saptamanal The Cursed Land"
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
    ctx.waitUntil(dispatchDueNotifications(env).catch((error) => ({
      ok: false,
      error: error?.message || "Scheduled dispatch failed"
    })));

    ctx.waitUntil(refreshAnalyticsIfDue(env).catch((error) => {
      console.warn("Analytics refresh failed", error?.message || error);
    }));

    const kv = env.TCL_EVENT_PUSH_KV;
    if (!kv) return;

    const today = new Date().toISOString().slice(0, 10);
    ctx.waitUntil((async () => {
      const lastReconcile = await kv.get("stats:last-reconcile");
      if (lastReconcile === today) return;
      await reconcileSubscriberCount(kv);
      await kv.put("stats:last-reconcile", today);
    })().catch((error) => {
      console.warn("Subscriber reconcile failed", error?.message || error);
    }));
  }
};

async function handleRequest(request, env, ctx) {
  if (request.method === "OPTIONS") return emptyResponse(request, env);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  try {
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
  await recordSubscriberStatsHistory(kv, stats.subscribers).catch(() => {});
  return jsonResponse(request, env, 200, {
    ok: true,
    subscribers: stats.subscribers,
    configured: true,
    source: stats.source,
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

  const report = await dispatchDueNotifications(env);
  return jsonResponse(request, env, 200, report);
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

async function dispatchDueNotifications(env) {
  const kv = requireKv(env);
  const subscriptions = await listSubscriptions(kv);
  const events = await loadEvents(env);
  const now = new Date();
  const report = {
    ok: true,
    checked: subscriptions.length,
    due: 0,
    sent: 0,
    skipped: 0,
    invalid: 0,
    errors: 0
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

  return report;
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
      const occurrence = getEventOccurrence(day, event, now);
      if (!occurrence) return;

      const startAt = occurrence.start.getTime();
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

async function reserveSentKey(kv, key) {
  const existing = await kv.get(key);
  if (existing) return false;
  await kv.put(key, "1", { expirationTtl: SENT_TTL_SECONDS });
  return true;
}

function getEventOccurrence(day, event, now) {
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
  if (end < now) {
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
