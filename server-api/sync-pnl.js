/**
 * TCL PNL Sync — server-side cron script
 * Replaces the tcl-pnl-sync Cloudflare Worker
 * Runs every 10 minutes via cron: * /10 * * * * node /opt/tcl-api/sync-pnl.js
 *
 * Phases:
 *   1. Incremental — pulls new TCL transfers since newest_ts
 *   2. Backfill    — paginates historical transfers back to LISTING_TIMESTAMP
 *   3. Enrich      — fetches operations for swap roots missing them
 */

// Load .env
import { readFileSync } from "fs";
try {
  readFileSync("/opt/tcl-api/.env", "utf8").split("\n").forEach(line => {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.startsWith("#")) {
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  });
} catch { /* optional */ }

import pg from "pg";
const { Pool } = pg;

// ── Config ────────────────────────────────────────────────────────────────────
const MVX_API          = "https://api.multiversx.com";
const TCL_TOKEN        = "TCL-fe459d";
const LISTING_TS       = 1718236800;   // 2024-06-13 00:00 UTC
const PAGE_SIZE        = 50;           // max with withOperations=true
const PAGES_PER_RUN    = 20;           // 20 × 50 = 1000 per run
const UPSERT_CHUNK     = 200;
const ENRICH_FRESH     = 150;
const ENRICH_BACKLOG   = 100;
const ENRICH_BATCH     = 50;
const MAX_WINDOW       = 10000;
const TCL_GAME         = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk";

const SWAP_FUNCTIONS = new Set([
  "swapTokensFixedInput","swapTokensFixedOutput","multiPairSwap",
  "multiPairSwapTokensFixedInput","swap","aggregateEsdt","aggregateEgld",
  "xo","buySwap","composeTasks",
]);

const KNOWN_AGGREGATORS = new Set([
  "erd1qqqqqqqqqqqqqpgqcc69ts8409p3h77q5chsaqz57y6hugvc4fvs64k74v",
  "erd1qqqqqqqqqqqqqpgq5rf2sppxk2xu4m0pkmugw2es4gak3rgjah0sxvajva",
  "erd1qqqqqqqqqqqqqpgqn7wy983tdh5katf5yn5nl2gcdflf4azh6jtsggjx9a",
  "erd1qqqqqqqqqqqqqpgqq66xk9gfr4esuhem3jru86wg5hvp33a62jps2fy57p",
  "erd1qqqqqqqqqqqqqpgqsytkvnexypp7argk02l0rasnj57sxa542jpshkl7df",
]);

// ── DB pool ───────────────────────────────────────────────────────────────────
const pool = new Pool({
  database: process.env.DB_NAME || "tcl_db",
  user:     process.env.DB_USER || "tcl_app",
  password: process.env.DB_PASSWORD,
  host:     process.env.DB_HOST || "127.0.0.1",
  port:     Number(process.env.DB_PORT) || 5432,
  max: 5,
});

const db = {
  query: (text, params) => pool.query(text, params),
  one:   async (text, params) => { const r = await pool.query(text, params); return r.rows[0] || null; },
  all:   async (text, params) => { const r = await pool.query(text, params); return r.rows; },
};

// ── State helpers ─────────────────────────────────────────────────────────────
async function getState(key) {
  const row = await db.one("SELECT value FROM tcl_sync_state WHERE key=$1", [key]);
  return row?.value ?? null;
}
async function setState(key, value) {
  await db.query(
    "INSERT INTO tcl_sync_state (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
    [key, String(value)]
  );
}

// ── MVX API ───────────────────────────────────────────────────────────────────
async function mvxFetch(path, params = {}) {
  const url = new URL(`${MVX_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`MVX ${res.status}`); continue; }
      if (!res.ok) throw new Error(`MVX ${res.status}`);
      return res.json();
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Row mapping ───────────────────────────────────────────────────────────────
function entryToRow(entry) {
  const hasOps   = Array.isArray(entry.operations) && entry.operations.length > 0;
  const isSwapRoot = !entry.originalTxHash && SWAP_FUNCTIONS.has(entry.function);
  return {
    tx_hash:          entry.txHash || (entry.originalTxHash + ":" + (entry.type || "scr")),
    original_tx_hash: entry.originalTxHash || null,
    type:             entry.type || null,
    sender:           entry.sender || "",
    receiver:         entry.receiver || "",
    ts:               Number(entry.timestamp) || 0,
    function:         entry.function || null,
    status:           entry.status || "success",
    action_transfers: Array.isArray(entry.action?.arguments?.transfers) ? entry.action.arguments.transfers : null,
    operations:       Array.isArray(entry.operations) ? entry.operations : null,
    enriched:         hasOps || !isSwapRoot,
  };
}

function txToRow(tx) {
  return {
    tx_hash:          tx.txHash || tx.hash,
    original_tx_hash: null,
    type:             tx.type || "Transaction",
    sender:           tx.sender || "",
    receiver:         tx.receiver || "",
    ts:               Number(tx.timestamp) || 0,
    function:         tx.function || null,
    status:           tx.status || "success",
    action_transfers: Array.isArray(tx.action?.arguments?.transfers) ? tx.action.arguments.transfers : null,
    operations:       Array.isArray(tx.operations) ? tx.operations : null,
    enriched:         true,
  };
}

function validTxHash(h) { return /^[0-9a-f]{64}$/i.test(String(h || "")); }

// ── Upsert ────────────────────────────────────────────────────────────────────
async function upsertRows(rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    // Build VALUES placeholders
    const placeholders = chunk.map((_, ri) => {
      const base = ri * 12;
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12})`;
    }).join(",");
    const values = chunk.flatMap(r => [
      r.tx_hash, r.original_tx_hash, r.type, r.sender, r.receiver, r.ts,
      r.function, r.status,
      r.action_transfers ? JSON.stringify(r.action_transfers) : null,
      r.operations       ? JSON.stringify(r.operations)       : null,
      r.enriched ?? true,
      new Date().toISOString(),
    ]);
    await db.query(`
      INSERT INTO tcl_transfers
        (tx_hash,original_tx_hash,type,sender,receiver,ts,function,status,action_transfers,operations,enriched,synced_at)
      VALUES ${placeholders}
      ON CONFLICT (tx_hash) DO UPDATE SET
        operations       = EXCLUDED.operations,
        enriched         = EXCLUDED.enriched,
        synced_at        = EXCLUDED.synced_at
    `, values);
  }
}

// ── Phase 1: Incremental ──────────────────────────────────────────────────────
async function syncIncremental(log) {
  const newestTsStr = await getState("newest_ts");
  const newestTs    = newestTsStr ? parseInt(newestTsStr, 10) : 0;
  log(`[incremental] newest_ts=${newestTs}`);

  let offset = 0, totalNew = 0, newNewestTs = newestTs;
  const enrichRoots = new Set();

  for (let page = 0; page < PAGES_PER_RUN; page++) {
    const entries = await mvxFetch(`/tokens/${TCL_TOKEN}/transfers`, {
      size: PAGE_SIZE, from: offset, order: "desc", status: "success",
      withOperations: "true",
      after: newestTs > 0 ? newestTs : undefined,
    });

    if (!Array.isArray(entries) || !entries.length) break;

    const fresh = entries.filter(e => Number(e.timestamp) > newestTs);
    if (!fresh.length) break;

    await upsertRows(fresh.map(entryToRow));
    totalNew += fresh.length;

    for (const e of fresh) {
      const root = e.originalTxHash || e.txHash;
      if (!validTxHash(root)) continue;
      const isSwap  = SWAP_FUNCTIONS.has(e.function);
      const isDexScr = Boolean(e.originalTxHash) && e.sender !== TCL_GAME
        && (KNOWN_AGGREGATORS.has(e.sender) || String(e.sender||"").startsWith("erd1qqqq"));
      if (isSwap || isDexScr) enrichRoots.add(root);
    }

    const pageMax = Math.max(...fresh.map(e => Number(e.timestamp) || 0));
    if (pageMax > newNewestTs) newNewestTs = pageMax;
    if (fresh.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    await sleep(120);
  }

  if (newNewestTs > newestTs) await setState("newest_ts", newNewestTs);

  if (enrichRoots.size) {
    const roots = Array.from(enrichRoots).slice(0, ENRICH_FRESH);
    const n = await enrichRoots_(roots);
    log(`[incremental] enriched ${n} new swap roots`);
  }

  log(`[incremental] ${totalNew} new transfers`);
  return totalNew;
}

// ── Phase 2: Backfill ─────────────────────────────────────────────────────────
async function syncBackfill(log) {
  const done = await getState("backfill_done");
  if (done === "true") { log("[backfill] already complete"); return 0; }

  let offset    = parseInt(await getState("backfill_offset")    || "0", 10);
  let cursorTs  = parseInt(await getState("backfill_cursor_ts") || "0", 10) || null;

  log(`[backfill] offset=${offset} cursor_ts=${cursorTs}`);

  let totalSynced = 0, reached = false, windowMin = Infinity;

  for (let page = 0; page < PAGES_PER_RUN; page++) {
    if (offset + PAGE_SIZE > MAX_WINDOW) {
      cursorTs  = windowMin < Infinity ? windowMin : cursorTs;
      offset    = 0;
      windowMin = Infinity;
      await setState("backfill_cursor_ts", cursorTs);
      await setState("backfill_offset", 0);
      log(`[backfill] new window, cursor_ts=${cursorTs}`);
    }

    const entries = await mvxFetch(`/tokens/${TCL_TOKEN}/transfers`, {
      size: PAGE_SIZE, from: offset, order: "desc", status: "success",
      withOperations: "true",
      before: cursorTs || undefined,
    });

    if (!Array.isArray(entries) || !entries.length) { reached = true; break; }

    await upsertRows(entries.map(entryToRow));
    totalSynced += entries.length;
    offset += PAGE_SIZE;

    const pageMin = Math.min(...entries.map(e => Number(e.timestamp) || Infinity));
    if (pageMin < windowMin) windowMin = pageMin;
    if (pageMin <= LISTING_TS || entries.length < PAGE_SIZE) { reached = true; break; }
    await sleep(120);
  }

  await setState("backfill_offset", offset);
  if (cursorTs) await setState("backfill_cursor_ts", cursorTs);
  if (reached) {
    await setState("backfill_done", "true");
    log("[backfill] COMPLETE");
  } else {
    log(`[backfill] offset=${offset} cursor_ts=${cursorTs}, ${totalSynced} entries`);
  }
  return totalSynced;
}

// ── Phase 3: Enrich backlog ───────────────────────────────────────────────────
async function enrichRoots_(rootHashes) {
  const rows = [];
  for (let i = 0; i < rootHashes.length; i += ENRICH_BATCH) {
    const batch = rootHashes.slice(i, i + ENRICH_BATCH);
    const txs = await mvxFetch("/transactions", {
      hashes: batch.join(","),
      size: String(batch.length),
      withOperations: "true",
    });
    if (Array.isArray(txs)) rows.push(...txs.map(txToRow).filter(r => validTxHash(r.tx_hash)));
    await sleep(120);
  }
  if (rows.length) await upsertRows(rows);
  return rows.length;
}

async function syncEnrichBacklog(log) {
  const rows = await db.all(
    "SELECT tx_hash FROM tcl_transfers WHERE enriched=false ORDER BY ts DESC LIMIT $1",
    [ENRICH_BACKLOG]
  );
  const roots = rows.map(r => r.tx_hash).filter(validTxHash);
  if (!roots.length) { log("[backlog] nothing to enrich"); return 0; }
  const n = await enrichRoots_(roots);
  log(`[backlog] enriched ${n} roots (of ${roots.length} selected)`);
  return n;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const log = (...args) => console.log(new Date().toISOString(), ...args);
  log("=== TCL PNL Sync START ===");

  let newCount = 0, backfillCount = 0, backlogCount = 0;

  try { newCount      = await syncIncremental(log); }
  catch (e) { log("[incremental] ERROR:", e.message); }

  try { backfillCount = await syncBackfill(log); }
  catch (e) { log("[backfill] ERROR:", e.message); }

  try { backlogCount  = await syncEnrichBacklog(log); }
  catch (e) { log("[backlog] ERROR:", e.message); }

  log(`=== DONE: +${newCount} new, +${backfillCount} backfill, +${backlogCount} enriched ===`);
  await pool.end();
}

main().catch(err => { console.error(err); pool.end(); process.exit(1); });
