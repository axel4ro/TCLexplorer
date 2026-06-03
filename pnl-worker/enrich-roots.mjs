// enrich-roots.mjs — Enrichuieste root-urile de swap/aggregator lipsa in Supabase
// Rulare: node enrich-roots.mjs   (citeste SUPABASE_SERVICE_ROLE_KEY din .dev.vars)
//
// DE CE: un buy prin aggregator (AshSwap/XOXNO/OneDex/xExchange) trimite walletului
// TCL printr-un SCR, dar tranzactia ROOT (aggregateEgld/aggregateEsdt/xo/composeTasks)
// muta tokenul de input (EGLD/USDC), NU TCL — deci root-ul NU apare in
// /tokens/TCL-fe459d/transfers si nu exista ca rand in Supabase. Fara `operations`
// pe root, PNL-ul nu poate calcula costul USDC al buy-ului (apare 0).
//
// Acest script descopera toate root-urile referite de SCR-uri DEX (sender = aggregator
// sau pool/router), verifica care nu au `operations` in Supabase, le aduce de la MVX
// (/transactions?hashes=...&withOperations=true) si le face upsert cu enriched=true.
//
// Idempotent + reluabil: cursorul de timestamp e salvat in tcl_sync_state
// (key=root_enrich_cursor_ts). Ruleaza-l periodic (ex: task programat) pe langa worker.

import { readFileSync, existsSync } from "fs";

const SUPABASE_URL = "https://phhzrfzhwwooeqsdztee.supabase.co";
const MVX_API      = "https://api.multiversx.com";
const TCL_TOKEN    = "TCL-fe459d";
const LISTING_TS   = 1718236800;        // 2024-06-13
const PAGE_SIZE    = 1000;              // randuri Supabase per pagina la descoperire
const ENRICH_BATCH = 40;               // hash-uri per cerere MVX /transactions
const CHECK_BATCH  = 80;               // hash-uri per cerere de verificare Supabase
const UPSERT_CHUNK = 200;
const MVX_INTERVAL_MS = 1100;          // ~55 req/min — sub rate limit-ul MVX

// Game contract exclus (earned/burn, nu e swap)
const GAME = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk";
// Contractele DEX care livreaza TCL la wallet intr-un buy (aggregatori + pool + routere).
const DEX_SENDERS = [
  "erd1qqqqqqqqqqqqqpgqcc69ts8409p3h77q5chsaqz57y6hugvc4fvs64k74v", // AshSwap: Aggregator v2
  "erd1qqqqqqqqqqqqqpgq5rf2sppxk2xu4m0pkmugw2es4gak3rgjah0sxvajva", // XOXNO: Swap Aggregator
  "erd1qqqqqqqqqqqqqpgqn7wy983tdh5katf5yn5nl2gcdflf4azh6jtsggjx9a", // OneDex: Aggregator
  "erd1qqqqqqqqqqqqqpgqq66xk9gfr4esuhem3jru86wg5hvp33a62jps2fy57p", // xExchange: Router
  "erd1qqqqqqqqqqqqqpgqsytkvnexypp7argk02l0rasnj57sxa542jpshkl7df", // xExchange: Tasks Composer
  "erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff", // xExchange: USDC/TCL Pair (buy direct)
];

// ── key ──────────────────────────────────────────────────────
let SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_KEY && existsSync(".dev.vars")) {
  const m = readFileSync(".dev.vars", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*"?([^"\n\r]+)/);
  if (m) SUPABASE_KEY = m[1].trim();
}
if (!SUPABASE_KEY) { console.error("EROARE: SUPABASE_SERVICE_ROLE_KEY lipseste (.dev.vars sau env)."); process.exit(1); }

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36";
const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "User-Agent": UA };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sbGet(path, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { headers: { ...sbHeaders, Prefer: "return=representation" } });
  if (!r.ok) throw new Error(`Supabase GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbUpsert(table, rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) throw new Error(`Supabase upsert ${table}: ${r.status} ${await r.text()}`);
  }
}
async function sbState(key, value) {
  if (value === undefined) {
    const rows = await sbGet("tcl_sync_state", { key: `eq.${key}`, select: "value" });
    return rows[0]?.value ?? null;
  }
  await sbUpsert("tcl_sync_state", [{ key, value: String(value) }]);
}

let lastMvx = 0;
async function mvxFetch(path, params = {}) {
  const wait = MVX_INTERVAL_MS - (Date.now() - lastMvx);
  if (wait > 0) await sleep(wait);
  lastMvx = Date.now();
  const url = new URL(`${MVX_API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) { await sleep(attempt * 4000); lastMvx = 0; }
    try {
      const r = await fetch(url.toString(), { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429 || r.status >= 500) continue;
      if (!r.ok) throw new Error(`MVX ${r.status}`);
      return r.json();
    } catch (e) { if (attempt === 3) throw e; }
  }
  throw new Error("MVX fetch failed");
}

const isHash = (h) => /^[0-9a-f]{64}$/i.test(String(h || ""));

function txToRow(tx) {
  const at = tx.action?.arguments?.transfers;
  return {
    tx_hash: tx.txHash,
    original_tx_hash: null,
    type: tx.type || "Transaction",
    sender: tx.sender || "",
    receiver: tx.receiver || "",
    ts: Number(tx.timestamp) || 0,
    function: tx.function || null,
    status: tx.status || "success",
    action_transfers: Array.isArray(at) ? at : null,
    operations: Array.isArray(tx.operations) ? tx.operations : null,
    enriched: true,
  };
}

// Verifica ce root-uri NU au inca operations in Supabase
async function filterMissing(roots) {
  const missing = [];
  for (let i = 0; i < roots.length; i += CHECK_BATCH) {
    const batch = roots.slice(i, i + CHECK_BATCH);
    const rows = await sbGet("tcl_transfers", { tx_hash: `in.(${batch.join(",")})`, select: "tx_hash,operations" });
    const have = new Set(rows.filter(r => Array.isArray(r.operations) && r.operations.length).map(r => r.tx_hash));
    for (const h of batch) if (!have.has(h)) missing.push(h);
  }
  return missing;
}

async function enrich(roots) {
  let up = 0;
  for (let i = 0; i < roots.length; i += ENRICH_BATCH) {
    const batch = roots.slice(i, i + ENRICH_BATCH);
    try {
      const txs = await mvxFetch("/transactions", {
        hashes: batch.join(","), size: batch.length, withOperations: "true",
        fields: "txHash,type,sender,receiver,timestamp,function,status,action,operations",
      });
      const rows = (Array.isArray(txs) ? txs : []).map(txToRow).filter(r => isHash(r.tx_hash));
      if (rows.length) { await sbUpsert("tcl_transfers", rows); up += rows.length; }
    } catch (e) {
      // Un batch picat (MVX hiccup) nu trebuie sa opreasca tot — raman missing si
      // sunt re-verificate la urmatoarea rulare (resetand root_enrich_cursor_ts).
      process.stdout.write(`\n  [skip batch] ${e.message}\n`);
    }
  }
  return up;
}

async function main() {
  console.log("=== TCL root enrichment (aggregator/swap) ===");
  const senderFilter = `in.(${DEX_SENDERS.join(",")})`;
  // Reluare: porneste de la cursorul salvat (descrescator pe ts). null = de la cel mai nou.
  let cursorTs = parseInt(await sbState("root_enrich_cursor_ts") || "0", 10) || null;
  console.log(cursorTs ? `Reluare de la ts<${cursorTs} (${new Date(cursorTs*1000).toISOString()})` : "Start de la cele mai noi SCR-uri");

  let totalEnriched = 0, totalRoots = 0, page = 0;
  while (true) {
    const params = {
      sender: senderFilter,
      receiver: "like.erd1*",            // livrat la un wallet
      order: "ts.desc",
      limit: String(PAGE_SIZE),
      select: "tx_hash,original_tx_hash,sender,receiver,ts",
    };
    if (cursorTs) params.ts = `lt.${cursorTs}`;
    let rows;
    try { rows = await sbGet("tcl_transfers", params); }
    catch (e) { console.log("\nSupabase eroare:", e.message, "— progres salvat, reia."); process.exit(1); }
    if (!Array.isArray(rows) || !rows.length) { console.log("\nNu mai sunt SCR-uri DEX — COMPLET."); await sbState("root_enrich_done", "true"); break; }

    // Exclude receiver = contract (erd1qqqq) si game; pastreaza doar livrari catre wallet
    const roots = Array.from(new Set(rows
      .filter(r => r.receiver && !r.receiver.startsWith("erd1qqqq") && r.sender !== GAME)
      .map(r => (r.original_tx_hash || r.tx_hash))
      .filter(isHash)));
    totalRoots += roots.length;

    const missing = roots.length ? await filterMissing(roots) : [];
    const up = missing.length ? await enrich(missing) : 0;
    totalEnriched += up;
    page++;

    const minTs = Math.min(...rows.map(r => Number(r.ts) || Infinity));
    cursorTs = minTs;
    await sbState("root_enrich_cursor_ts", cursorTs);
    process.stdout.write(`\r  P${page} | ts<${new Date(cursorTs*1000).toISOString().slice(0,10)} | roots ${totalRoots} | missing+ ${missing.length} | enriched ${totalEnriched}   `);

    if (rows.length < PAGE_SIZE || minTs <= LISTING_TS) { console.log("\nAtins inceputul — COMPLET."); await sbState("root_enrich_done", "true"); break; }
  }
  console.log(`\nGATA. Root-uri verificate: ${totalRoots}, enrichuite: ${totalEnriched}`);
}

main().catch(e => { console.error("\nEROARE fatala:", e.message); process.exit(1); });
