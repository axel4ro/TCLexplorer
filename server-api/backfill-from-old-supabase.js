/**
 * One-shot backfill: copy tcl_transfers rows from the FROZEN hosted Supabase
 * (phhzrfzhwwooeqsdztee.supabase.co, last updated ~2026-06-08) into the live VPS
 * tcl_db. The VPS DB was rebuilt by sync-pnl and is missing the historical
 * aggregator/router swap roots that enrich-roots.mjs had added to the old Supabase
 * (so wallets show fewer sells than reality). INSERT ON CONFLICT (tx_hash) DO NOTHING
 * — never overwrites live rows, only adds the missing historical ones. Idempotent.
 *
 * Run on the VPS: node /opt/tcl-api/backfill-from-old-supabase.js
 */

import { readFileSync } from "fs";
try {
  readFileSync("/opt/tcl-api/.env", "utf8").split("\n").forEach(line => {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.startsWith("#")) {
      const k = line.slice(0, eq).trim(), v = line.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  });
} catch {}

import pg from "pg";
const { Pool } = pg;

const OLD_URL  = "https://phhzrfzhwwooeqsdztee.supabase.co";
const OLD_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoaHpyZnpod3dvb2Vxc2R6dGVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODI2MzksImV4cCI6MjA5NTQ1ODYzOX0.TPJ2e5FbbWNqthkgHAC-r2WsMiP29CbfNkBaMFyf-yw";
const PAGE = 1000;
const COLS = "tx_hash,original_tx_hash,type,sender,receiver,ts,function,status,action_transfers,operations";

const pool = new Pool({
  database: process.env.DB_NAME || "tcl_db",
  user:     process.env.DB_USER || "tcl_app",
  password: process.env.DB_PASSWORD,
  host:     process.env.DB_HOST || "127.0.0.1",
  port:     Number(process.env.DB_PORT) || 5432,
  max: 4,
});

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Keyset pagination on the tx_hash PK — avoids deep-offset timeouts (PostgREST
// OFFSET is O(n) and dies past ~255k rows). afterHash="" fetches the first page.
async function fetchPage(afterHash) {
  const filter = afterHash ? `&tx_hash=gt.${afterHash}` : "";
  const url = `${OLD_URL}/rest/v1/tcl_transfers?select=${COLS}&order=tx_hash.asc&limit=${PAGE}${filter}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { apikey: OLD_ANON, Authorization: `Bearer ${OLD_ANON}`, Accept: "application/json" },
        signal: AbortSignal.timeout(40000),
      });
      if (!r.ok) { await sleep(1500 * (attempt + 1)); continue; }
      const rows = await r.json();
      if (Array.isArray(rows)) return rows;
    } catch (_) { await sleep(1500 * (attempt + 1)); }
  }
  throw new Error(`fetchPage(after=${afterHash}) failed`);
}

async function upsertBatch(rows) {
  if (!rows.length) return 0;
  const cols = ["tx_hash","original_tx_hash","type","sender","receiver","ts","function","status","action_transfers","operations","enriched"];
  const values = [];
  const params = [];
  let i = 1;
  for (const r of rows) {
    if (!r.tx_hash) continue;
    const enriched = r.operations != null;
    params.push(
      r.tx_hash, r.original_tx_hash ?? null, r.type ?? null, r.sender ?? null, r.receiver ?? null,
      Number(r.ts) || null, r.function ?? null, r.status ?? null,
      r.action_transfers != null ? JSON.stringify(r.action_transfers) : null,
      r.operations != null ? JSON.stringify(r.operations) : null,
      enriched
    );
    const ph = cols.map(() => `$${i++}`);
    values.push(`(${ph.join(",")})`);
  }
  if (!values.length) return 0;
  const sql = `INSERT INTO tcl_transfers (${cols.join(",")}) VALUES ${values.join(",")}
               ON CONFLICT (tx_hash) DO NOTHING`;
  const res = await pool.query(sql, params);
  return res.rowCount || 0;
}

async function main() {
  log("=== BACKFILL from old Supabase START ===");
  const before = (await pool.query("SELECT count(*)::int c FROM tcl_transfers")).rows[0].c;
  log(`VPS rows before: ${before}`);
  let afterHash = "", totalSeen = 0, totalAdded = 0, batch = 0;
  while (true) {
    const rows = await fetchPage(afterHash);
    if (!rows.length) break;
    totalSeen += rows.length;
    const added = await upsertBatch(rows);
    totalAdded += added;
    afterHash = rows[rows.length - 1].tx_hash;
    if (++batch % 10 === 0) log(`seen=${totalSeen} added=${totalAdded} lastHash=${afterHash.slice(0, 12)}`);
    if (rows.length < PAGE) break;
  }
  const after = (await pool.query("SELECT count(*)::int c FROM tcl_transfers")).rows[0].c;
  log(`=== DONE: seen=${totalSeen} added=${totalAdded} | VPS rows ${before} -> ${after} ===`);
}

main().catch(e => { log("ERROR:", e.message || e); process.exitCode = 1; }).finally(() => pool.end());
