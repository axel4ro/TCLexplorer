// ============================================================
// tcl-pnl-sync — Cloudflare Worker
//
// Cron (*/10 * * * *):
//   - Fase 1 INCREMENTAL: aduce transferuri noi (de la newest_ts in sus)
//   - Faza 2 BACKFILL:    aduce pagini istorice (order=asc, from offset)
//     pana ajunge la LISTING_TIMESTAMP
//
// HTTP endpoints:
//   GET  /api/status              — starea sync-ului
//   POST /api/sync?secret=XXX     — trigger manual (backfill + incremental)
//   GET  /api/transfers?wallet=erd1...  — toate transferurile unui wallet din Supabase
// ============================================================

const PAGE_SIZE = 50;       // max cu withOperations=true
const PAGES_PER_CRON = 10;  // 10 pagini × 50 = 500 intrari per run (max safe: ~46/50 subrequests)
const UPSERT_CHUNK = 200;   // cate randuri upsertam odata in Supabase

// ── CORS ────────────────────────────────────────────────────

function corsHeaders(env, req) {
  const origin = req?.headers?.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim());
  const ok = allowed.some((a) => origin === a || origin.startsWith(a));
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status = 200, env, req) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env, req) },
  });
}

// ── Supabase helpers ─────────────────────────────────────────

function supabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

async function supabaseGet(env, path, params = {}) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { ...supabaseHeaders(env), Prefer: "return=representation" },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabaseUpsert(env, table, rows) {
  if (!rows.length) return;
  // Upsert in chunk-uri pentru a evita payload-uri mari
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const url = `${env.SUPABASE_URL}/rest/v1/${table}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...supabaseHeaders(env),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase upsert ${table}: ${res.status} ${body}`);
    }
  }
}

async function supabaseSet(env, key, value) {
  await supabaseUpsert(env, "tcl_sync_state", [{ key, value: String(value) }]);
}

async function supabaseGetState(env, key) {
  const rows = await supabaseGet(env, "tcl_sync_state", {
    key: `eq.${key}`,
    select: "value",
  });
  return rows[0]?.value ?? null;
}

// ── MultiversX API ───────────────────────────────────────────

async function mvxFetch(env, path, params = {}) {
  const url = new URL(`${env.MVX_API}${path}`);
  // Sari peste valorile undefined/null
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`MVX ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`MVX ${res.status}`);
      return res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Mapeaza un entry din MVX API la randul din Supabase
function entryToRow(entry) {
  return {
    tx_hash: entry.txHash || entry.originalTxHash + ":" + (entry.type || "scr"),
    original_tx_hash: entry.originalTxHash || null,
    type: entry.type || null,
    sender: entry.sender || "",
    receiver: entry.receiver || "",
    ts: Number(entry.timestamp) || 0,
    function: entry.function || null,
    status: entry.status || "success",
    action_transfers: Array.isArray(entry.action?.arguments?.transfers)
      ? entry.action.arguments.transfers
      : null,
    operations: Array.isArray(entry.operations) ? entry.operations : null,
  };
}

// ── Sync logic ───────────────────────────────────────────────

// Faza 1 – aduce transferuri noi (mai noi decat newest_ts)
async function syncIncremental(env, log) {
  const newestTsStr = await supabaseGetState(env, "newest_ts");
  const newestTs = newestTsStr ? parseInt(newestTsStr, 10) : 0;

  log(`[incremental] newest_ts=${newestTs}`);

  let offset = 0;
  let totalNew = 0;
  let newNewestTs = newestTs;

  for (let page = 0; page < PAGES_PER_CRON; page++) {
    const entries = await mvxFetch(
      env,
      `/tokens/${env.TCL_TOKEN}/transfers`,
      {
        size: String(PAGE_SIZE),
        from: String(offset),
        order: "desc",
        status: "success",
        withOperations: "true",
        after: newestTs > 0 ? String(newestTs) : undefined,
      }
    );

    if (!Array.isArray(entries) || !entries.length) break;

    // Filtreaza doar ce e mai nou
    const fresh = entries.filter((e) => Number(e.timestamp) > newestTs);
    if (!fresh.length) break;

    const rows = fresh.map(entryToRow);
    await supabaseUpsert(env, "tcl_transfers", rows);
    totalNew += rows.length;

    const pageMax = Math.max(...fresh.map((e) => Number(e.timestamp) || 0));
    if (pageMax > newNewestTs) newNewestTs = pageMax;

    if (fresh.length < PAGE_SIZE) break; // ultima pagina
    offset += PAGE_SIZE;
    await sleep(120);
  }

  if (newNewestTs > newestTs) {
    await supabaseSet(env, "newest_ts", newNewestTs);
  }
  log(`[incremental] ${totalNew} transferuri noi`);
  return totalNew;
}

// Faza 2 – backfill: pagineaza din trecut (order=asc, from offset)
// Opreste cand ajunge la LISTING_TIMESTAMP sau epuizeaza PAGES_PER_CRON pagini
async function syncBackfill(env, log) {
  const done = await supabaseGetState(env, "backfill_done");
  if (done === "true") {
    log("[backfill] deja complet");
    return 0;
  }

  const listingTs = parseInt(env.LISTING_TIMESTAMP || "1718236800", 10);
  const offsetStr = await supabaseGetState(env, "backfill_offset");
  let offset = offsetStr ? parseInt(offsetStr, 10) : 0;

  log(`[backfill] start offset=${offset}`);

  let totalSynced = 0;
  let reachedListing = false;

  for (let page = 0; page < PAGES_PER_CRON; page++) {
    const entries = await mvxFetch(
      env,
      `/tokens/${env.TCL_TOKEN}/transfers`,
      {
        size: String(PAGE_SIZE),
        from: String(offset),
        order: "desc",          // cel mai recent primul — date utile rapide
        status: "success",
        withOperations: "true",
      }
    );

    if (!Array.isArray(entries) || !entries.length) {
      reachedListing = true; // epuizat istoricul
      break;
    }

    const rows = entries.map(entryToRow);
    await supabaseUpsert(env, "tcl_transfers", rows);
    totalSynced += rows.length;
    offset += PAGE_SIZE;

    // Verifica daca am ajuns la sau inainte de listing date
    const pageMin = Math.min(...entries.map((e) => Number(e.timestamp) || Infinity));
    if (pageMin <= listingTs) {
      reachedListing = true;
      break;
    }

    if (entries.length < PAGE_SIZE) {
      reachedListing = true;
      break;
    }

    await sleep(120);
  }

  await supabaseSet(env, "backfill_offset", offset);
  if (reachedListing) {
    await supabaseSet(env, "backfill_done", "true");
    log("[backfill] COMPLET");
  } else {
    log(`[backfill] offset avansat la ${offset}, ${totalSynced} intrari`);
  }

  return totalSynced;
}

// Run complet (incremental + backfill)
async function runSync(env, debug = false) {
  const log = (...args) => {
    if (env.DEBUG_ERRORS === "true") console.log(...args);
  };

  let newCount = 0;
  let backfillCount = 0;
  const errors = [];

  try {
    newCount = await syncIncremental(env, log);
  } catch (err) {
    log("[incremental] eroare:", err.message);
    if (debug) errors.push({ phase: "incremental", error: err.message, stack: err.stack });
  }

  try {
    backfillCount = await syncBackfill(env, log);
  } catch (err) {
    log("[backfill] eroare:", err.message);
    if (debug) errors.push({ phase: "backfill", error: err.message, stack: err.stack });
  }

  return debug
    ? { newCount, backfillCount, errors }
    : { newCount, backfillCount };
}

// ── HTTP handlers ─────────────────────────────────────────────

async function handleStatus(request, env) {
  // Citeste starea din tcl_sync_state
  const [newestTs, backfillOffset, backfillDone] = await Promise.all([
    supabaseGetState(env, "newest_ts").catch(() => null),
    supabaseGetState(env, "backfill_offset").catch(() => null),
    supabaseGetState(env, "backfill_done").catch(() => null),
  ]);

  // Numara randuri din tcl_transfers (cu Prefer: count=exact)
  let total = 0;
  try {
    const countRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tcl_transfers?select=tx_hash`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "count=exact",
        },
      }
    );
    const rangeHeader = countRes.headers.get("Content-Range") || "";
    total = parseInt(rangeHeader.split("/")[1] || "0", 10) || 0;
  } catch (_) { /* ignore */ }

  return {
    backfill_done: backfillDone === "true",
    backfill_offset: backfillOffset ? parseInt(backfillOffset, 10) : 0,
    newest_ts: newestTs ? parseInt(newestTs, 10) : 0,
    newest_date: newestTs ? new Date(parseInt(newestTs, 10) * 1000).toISOString() : null,
    total_transfers: total,
  };
}

async function handleTransfers(request, env) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet") || "";
  if (!wallet || !wallet.startsWith("erd1")) {
    return { error: "wallet invalid" };
  }

  // Limit la 50000 de randuri per wallet (mai mult decat destul)
  const transfers = await supabaseGet(env, "tcl_transfers", {
    or: `(sender.eq.${wallet},receiver.eq.${wallet})`,
    order: "ts.desc",
    limit: "50000",
    select: "tx_hash,original_tx_hash,type,sender,receiver,ts,function,status,action_transfers,operations",
  });

  return {
    wallet,
    count: transfers.length,
    transfers: transfers.map((row) => ({
      txHash: row.tx_hash,
      originalTxHash: row.original_tx_hash || undefined,
      type: row.type || undefined,
      sender: row.sender,
      receiver: row.receiver,
      timestamp: row.ts,
      function: row.function || undefined,
      status: row.status || "success",
      action: row.action_transfers
        ? { arguments: { transfers: row.action_transfers } }
        : undefined,
      operations: row.operations || undefined,
    })),
  };
}

// ── Main fetch handler ────────────────────────────────────────

export default {
  // HTTP requests
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    const path = url.pathname.replace(/\/$/, "");

    // GET /api/status
    if (path === "/api/status" && request.method === "GET") {
      try {
        const status = await handleStatus(request, env);
        return json(status, 200, env, request);
      } catch (err) {
        return json({ error: err.message }, 500, env, request);
      }
    }

    // POST /api/sync?secret=XXX  (trigger manual)
    if (path === "/api/sync" && request.method === "POST") {
      const secret = (url.searchParams.get("secret") || "").trim();
      const storedSecret = (env.SYNC_SECRET || "").trim();
      if (!secret || secret !== storedSecret) {
        return json({ error: "unauthorized" }, 401, env, request);
      }
      const debug = url.searchParams.get("debug") === "1";
      if (debug) {
        // Mod debug: ruleaza sincron si returneaza rezultatul complet
        try {
          const result = await runSync(env, true);
          return json({ ok: true, debug: true, result }, 200, env, request);
        } catch (err) {
          return json({ ok: false, debug: true, error: err.message, stack: err.stack }, 500, env, request);
        }
      }
      // Mod normal: ruleaza in background, returneaza imediat
      ctx.waitUntil(runSync(env));
      return json({ ok: true, message: "sync pornit in background" }, 202, env, request);
    }

    // GET /api/transfers?wallet=erd1...
    if (path === "/api/transfers" && request.method === "GET") {
      try {
        const data = await handleTransfers(request, env);
        if (data.error) return json(data, 400, env, request);

        // Trigger incremental sync in background la fiecare cerere
        ctx.waitUntil(syncIncremental(env, () => {}));

        return json(data, 200, env, request);
      } catch (err) {
        return json({ error: err.message }, 500, env, request);
      }
    }

    return json({ error: "not found" }, 404, env, request);
  },

  // Cron trigger (*/10 * * * *)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
};
