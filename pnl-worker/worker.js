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
//   GET  /api/enrich?wallet=erd1...     — completeaza root tx lipsa pentru PNL
// ============================================================

const PAGE_SIZE = 50;       // max cu withOperations=true
const PAGES_PER_CRON = 10;  // 10 pagini × 50 = 500 intrari per run (max safe: ~46/50 subrequests)
const UPSERT_CHUNK = 200;   // cate randuri upsertam odata in Supabase
const ROOT_ENRICH_LIMIT = 300;
const ENRICH_FRESH_LIMIT = 150;   // root-uri swap noi enrichuite per rulare de cron
const ENRICH_BACKLOG_LIMIT = 100; // root-uri din backlog (enriched=false) drenate per rulare
const ROOT_ENRICH_BATCH = 50;
const ROOT_SCAN_BATCH = 80;
const ROOT_SCAN_CHUNKS = 16;
const TCL_GAME_CONTRACT = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk";
const TCL_TRANSFER_SELECT = "tx_hash,original_tx_hash,type,sender,receiver,ts,function,status,action_transfers,operations";
const SWAP_FUNCTIONS = [
  "swapTokensFixedInput",
  "swapTokensFixedOutput",
  "multiPairSwap",
  "multiPairSwapTokensFixedInput",
  "swap",
  "aggregateEsdt",
  "aggregateEgld",
  "xo",
  "buySwap",
  "composeTasks",
];

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

async function supabaseGetAll(env, path, params = {}, pageSize = 1000) {
  const all = [];
  let offset = 0;

  while (true) {
    const rows = await supabaseGet(env, path, {
      ...params,
      limit: String(pageSize),
      offset: String(offset),
    });
    if (!Array.isArray(rows) || !rows.length) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return all;
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
  const hasOps = Array.isArray(entry.operations) && entry.operations.length > 0;
  // Doar swap-urile root fara operations intra in backlog (enriched=false).
  // Restul (earned, SCR-uri, swap-uri cu ops) raman enriched=true => indexul
  // partial de backlog ramane mic. Vezi supabase/tcl-pnl-enriched.sql.
  const isSwapRoot = !entry.originalTxHash && SWAP_FUNCTIONS.includes(entry.function);
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
    enriched: hasOps || !isSwapRoot,
  };
}

function transactionToRow(tx) {
  return {
    tx_hash: tx.txHash || tx.hash,
    original_tx_hash: null,
    type: tx.type || "Transaction",
    sender: tx.sender || "",
    receiver: tx.receiver || "",
    ts: Number(tx.timestamp) || 0,
    function: tx.function || null,
    status: tx.status || "success",
    action_transfers: Array.isArray(tx.action?.arguments?.transfers)
      ? tx.action.arguments.transfers
      : null,
    operations: Array.isArray(tx.operations) ? tx.operations : null,
    // Folosit doar post-enrichment (enrichRootTransactions) => marcam done ca sa
    // nu reprocesam la nesfarsit un root (chiar daca API-ul nu a dat operations).
    enriched: true,
  };
}

function validTxHash(hash) {
  return /^[0-9a-f]{64}$/i.test(String(hash || ""));
}

function firstTransferToken(row) {
  const first = Array.isArray(row.action_transfers) ? row.action_transfers[0] : null;
  return first?.token || first?.identifier || "";
}

async function fetchWalletPnlRootHashes(env, wallet) {
  const gameContract = env.PNL_GAME_CONTRACT || TCL_GAME_CONTRACT;
  const swapFns = SWAP_FUNCTIONS.join(",");

  const [sellRows, allBuyRows, earnedRows] = await Promise.all([
    supabaseGetAll(env, "tcl_transfers", {
      sender: `eq.${wallet}`,
      function: `in.(${swapFns})`,
      order: "ts.desc",
      select: TCL_TRANSFER_SELECT,
    }),
    supabaseGetAll(env, "tcl_transfers", {
      receiver: `eq.${wallet}`,
      sender: "like.erd1qqqq*",
      order: "ts.desc",
      select: TCL_TRANSFER_SELECT,
    }),
    supabaseGetAll(env, "tcl_transfers", {
      sender: `eq.${gameContract}`,
      receiver: `eq.${wallet}`,
      order: "ts.desc",
      select: "tx_hash,original_tx_hash",
    }),
  ]);

  const token = env.TCL_TOKEN || "TCL-fe459d";
  const sellRoots = sellRows
    .filter((row) => firstTransferToken(row) === token)
    .map((row) => row.original_tx_hash || row.tx_hash);
  const buyRoots = allBuyRows
    .filter((row) => row.sender !== wallet && row.sender !== gameContract && String(row.sender || "").startsWith("erd1qqqq"))
    .map((row) => row.original_tx_hash || row.tx_hash);
  const earnedRoots = earnedRows.map((row) => row.original_tx_hash || row.tx_hash);

  return Array.from(new Set([...sellRoots, ...buyRoots, ...earnedRoots].filter(validTxHash)));
}

async function findMissingRootHashes(env, roots, cursor, maxMissing) {
  const existing = new Map();
  const missing = [];
  let nextCursor = Math.min(Math.max(0, cursor), roots.length);
  let scannedRoots = 0;
  let scannedChunks = 0;

  while (
    nextCursor < roots.length &&
    missing.length < maxMissing &&
    scannedChunks < ROOT_SCAN_CHUNKS
  ) {
    const chunkRoots = roots.slice(nextCursor, nextCursor + ROOT_SCAN_BATCH);
    const chunk = chunkRoots.join(",");
    const rows = await supabaseGet(env, "tcl_transfers", {
      tx_hash: `in.(${chunk})`,
      select: "tx_hash,operations",
    });
    rows.forEach((row) => {
      existing.set(row.tx_hash, Array.isArray(row.operations) && row.operations.length > 0);
    });
    missing.push(...chunkRoots.filter((hash) => existing.get(hash) !== true));
    nextCursor += chunkRoots.length;
    scannedRoots += chunkRoots.length;
    scannedChunks += 1;
  }

  return {
    missing,
    nextCursor,
    scannedRoots,
    scannedChunks,
    doneScanning: nextCursor >= roots.length,
  };
}

async function enrichRootTransactions(env, rootHashes) {
  const rows = [];
  for (let i = 0; i < rootHashes.length; i += ROOT_ENRICH_BATCH) {
    const batch = rootHashes.slice(i, i + ROOT_ENRICH_BATCH);
    const txs = await mvxFetch(env, "/transactions", {
      hashes: batch.join(","),
      size: String(batch.length),
      withOperations: "true",
    });
    if (Array.isArray(txs)) {
      rows.push(...txs.map(transactionToRow).filter((row) => validTxHash(row.tx_hash)));
    }
    await sleep(120);
  }

  await supabaseUpsert(env, "tcl_transfers", rows);
  return rows.length;
}

// Drena backlog-ul de swap-uri root neenrichuite (enriched=false). Query-ul
// foloseste indexul partial tcl_transfers_need_enrich => ieftin (1 subrequest),
// chiar daca un scan "operations is null" ar da timeout. Bounded ca sa ramanem
// sub limita de subrequests; backlog-ul se goleste treptat peste mai multe rulari.
async function syncEnrichBacklog(env, log) {
  const rows = await supabaseGet(env, "tcl_transfers", {
    enriched: "eq.false",
    order: "ts.desc",
    limit: String(ENRICH_BACKLOG_LIMIT),
    select: "tx_hash",
  });
  const roots = (Array.isArray(rows) ? rows : [])
    .map((r) => r.tx_hash)
    .filter(validTxHash);
  if (!roots.length) {
    log("[backlog] nimic de enrichuit");
    return 0;
  }
  const n = await enrichRootTransactions(env, roots);
  log(`[backlog] enrichuit ${n} root-uri (din ${roots.length} selectate)`);
  return n;
}

// ── Sync logic ───────────────────────────────────────────────

// Faza 1 – aduce transferuri noi (mai noi decat newest_ts)
async function syncIncremental(env, log) {
  const newestTsStr = await supabaseGetState(env, "newest_ts");
  const newestTs = newestTsStr ? parseInt(newestTsStr, 10) : 0;

  log(`[incremental] newest_ts=${newestTs}`);

  const gameContract = env.PNL_GAME_CONTRACT || TCL_GAME_CONTRACT;
  let offset = 0;
  let totalNew = 0;
  let newNewestTs = newestTs;
  // Root-uri de swap/buy DEX care au nevoie de operations complete (multi-leg /
  // aggregator => endpoint-ul /tokens/transfers le da operations=null). Le
  // enrichuim imediat ca PNL-ul sa fie corect fara a astepta un /api/enrich manual.
  const enrichRoots = new Set();

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

    for (const e of fresh) {
      const root = e.originalTxHash || e.txHash;
      if (!validTxHash(root)) continue;
      const isSwapTx = SWAP_FUNCTIONS.includes(e.function);
      // SCR provenit de la un contract DEX (pair/aggregator), nu de la game =>
      // partea de "buy" unde wallet-ul trimite USDC si primeste TCL inapoi.
      const isDexScr = Boolean(e.originalTxHash)
        && String(e.sender || "").startsWith("erd1qqqq")
        && e.sender !== gameContract;
      if (isSwapTx || isDexScr) enrichRoots.add(root);
    }

    const pageMax = Math.max(...fresh.map((e) => Number(e.timestamp) || 0));
    if (pageMax > newNewestTs) newNewestTs = pageMax;

    if (fresh.length < PAGE_SIZE) break; // ultima pagina
    offset += PAGE_SIZE;
    await sleep(120);
  }

  if (newNewestTs > newestTs) {
    await supabaseSet(env, "newest_ts", newNewestTs);
  }

  // Enrichuieste root-urile de swap noi (bounded ca sa ramanem sub limita de
  // subrequests). Restul backlog-ului se completeaza prin /api/enrich per-wallet.
  if (enrichRoots.size) {
    const roots = Array.from(enrichRoots).slice(0, ENRICH_FRESH_LIMIT);
    try {
      const n = await enrichRootTransactions(env, roots);
      log(`[incremental] enrichuit ${n} root-uri swap noi (din ${enrichRoots.size})`);
    } catch (err) {
      log("[incremental] enrich root-uri noi esuat:", err.message);
    }
  }

  log(`[incremental] ${totalNew} transferuri noi`);
  return totalNew;
}

// Faza 2 – backfill: pagineaza cu cursor timestamp (evita limita MVX from+size<=10000)
async function syncBackfill(env, log) {
  const done = await supabaseGetState(env, "backfill_done");
  if (done === "true") {
    log("[backfill] deja complet");
    return 0;
  }

  const listingTs   = parseInt(env.LISTING_TIMESTAMP || "1718236800", 10);
  const MAX_WINDOW  = 10000;
  const offsetStr   = await supabaseGetState(env, "backfill_offset");
  const cursorTsStr = await supabaseGetState(env, "backfill_cursor_ts");
  let offset   = offsetStr   ? parseInt(offsetStr, 10)   : 0;
  let cursorTs = cursorTsStr ? parseInt(cursorTsStr, 10) : null;

  log(`[backfill] start offset=${offset} cursor_ts=${cursorTs}`);

  let totalSynced  = 0;
  let reachedListing = false;
  let windowMin    = Infinity;

  for (let page = 0; page < PAGES_PER_CRON; page++) {
    // Daca atingem limita ferestrei MVX, trece la urmatoarea fereastra cu cursor
    if (offset + PAGE_SIZE > MAX_WINDOW) {
      cursorTs = windowMin < Infinity ? windowMin : cursorTs;
      offset   = 0;
      windowMin = Infinity;
      await supabaseSet(env, "backfill_cursor_ts", cursorTs);
      await supabaseSet(env, "backfill_offset", 0);
      log(`[backfill] fereastra noua, cursor_ts=${cursorTs}`);
    }

    const entries = await mvxFetch(
      env,
      `/tokens/${env.TCL_TOKEN}/transfers`,
      {
        size:           String(PAGE_SIZE),
        from:           String(offset),
        order:          "desc",
        status:         "success",
        withOperations: "true",
        before:         cursorTs,   // null = ignorat de mvxFetch la prima fereastra
      }
    );

    if (!Array.isArray(entries) || !entries.length) {
      reachedListing = true;
      break;
    }

    const rows = entries.map(entryToRow);
    await supabaseUpsert(env, "tcl_transfers", rows);
    totalSynced += rows.length;
    offset += PAGE_SIZE;

    const pageMin = Math.min(...entries.map((e) => Number(e.timestamp) || Infinity));
    if (pageMin < windowMin) windowMin = pageMin;

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
  if (cursorTs) await supabaseSet(env, "backfill_cursor_ts", cursorTs);
  if (reachedListing) {
    await supabaseSet(env, "backfill_done", "true");
    log("[backfill] COMPLET");
  } else {
    log(`[backfill] offset=${offset} cursor_ts=${cursorTs}, ${totalSynced} intrari`);
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
  let backlogCount = 0;
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

  try {
    backlogCount = await syncEnrichBacklog(env, log);
  } catch (err) {
    log("[backlog] eroare:", err.message);
    if (debug) errors.push({ phase: "backlog", error: err.message, stack: err.stack });
  }

  return debug
    ? { newCount, backfillCount, backlogCount, errors }
    : { newCount, backfillCount, backlogCount };
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

async function handleEnrich(request, env) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet") || "";
  if (!wallet || !wallet.startsWith("erd1")) {
    return { error: "wallet invalid" };
  }

  const requestedLimit = parseInt(url.searchParams.get("limit") || String(ROOT_ENRICH_LIMIT), 10);
  const requestedCursor = parseInt(url.searchParams.get("cursor") || "0", 10);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : ROOT_ENRICH_LIMIT, ROOT_ENRICH_LIMIT));
  const cursor = Math.max(0, Number.isFinite(requestedCursor) ? requestedCursor : 0);
  const roots = await fetchWalletPnlRootHashes(env, wallet);
  const scan = await findMissingRootHashes(env, roots, cursor, limit);
  const toProcess = scan.missing;
  const upserted = toProcess.length ? await enrichRootTransactions(env, toProcess) : 0;
  const remaining = Math.max(0, roots.length - scan.nextCursor);

  return {
    ok: true,
    wallet,
    totalRoots: roots.length,
    cursor,
    nextCursor: scan.nextCursor,
    scannedRoots: scan.scannedRoots,
    scannedChunks: scan.scannedChunks,
    missingRoots: scan.missing.length,
    processed: toProcess.length,
    upserted,
    remaining,
    done: scan.doneScanning,
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

    // GET /api/enrich?wallet=erd1...&limit=450
    if (path === "/api/enrich" && request.method === "GET") {
      try {
        const data = await handleEnrich(request, env);
        if (data.error) return json(data, 400, env, request);
        return json(data, 200, env, request);
      } catch (err) {
        return json({ ok: false, error: err.message }, 500, env, request);
      }
    }

    return json({ error: "not found" }, 404, env, request);
  },

  // Cron trigger (*/10 * * * *)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
};
