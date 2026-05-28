// bulk-sync.mjs — Sync complet TCL transferuri de pe PC local catre Supabase
// Rulare: node bulk-sync.mjs
// Reia automat de unde a ramas (citeste starea din Supabase)
//
// Strategie paginare:
//   MVX API limita: from + size <= 10000
//   Solutie: cursor bazat pe timestamp — cand atingem limita de 10000,
//   reincepe de la from=0 cu before={cel mai vechi timestamp din fereastra}

const SUPABASE_URL = "https://phhzrfzhwwooeqsdztee.supabase.co";
const MVX_API      = "https://api.multiversx.com";
const TCL_TOKEN    = "TCL-fe459d";
const LISTING_TS   = 1718236800;   // 2024-06-13
const PAGE_SIZE    = 50;
const UPSERT_CHUNK = 200;
const DELAY_MS     = 120;          // intre pagini MVX
const MAX_WINDOW   = 10000;        // limita MVX pentru from+size

// ── Citeste key-ul din .dev.vars sau env ──────────────────────
import { readFileSync, existsSync } from "fs";

let SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_KEY && existsSync(".dev.vars")) {
  const vars = readFileSync(".dev.vars", "utf8");
  const m = vars.match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*"?([^"\n\r]+)"?/);
  if (m) SUPABASE_KEY = m[1].trim();
}
if (!SUPABASE_KEY) {
  console.error("EROARE: SUPABASE_SERVICE_ROLE_KEY nu e setat.");
  console.error("  Adauga in .dev.vars:  SUPABASE_SERVICE_ROLE_KEY=\"eyJ...\"");
  process.exit(1);
}

// ── Supabase helpers ─────────────────────────────────────────

const sbHeaders = {
  apikey:        SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer:        "return=minimal",
};

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

async function sbSet(key, value) {
  await sbUpsert("tcl_sync_state", [{ key, value: String(value) }]);
}

async function sbGetState(key) {
  const rows = await sbGet("tcl_sync_state", { key: `eq.${key}`, select: "value" });
  return rows[0]?.value ?? null;
}

// ── MultiversX API ───────────────────────────────────────────

async function mvxFetch(path, params = {}) {
  const url = new URL(`${MVX_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  let lastErr = new Error("MVX fetch failed");
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) {
      const wait = attempt <= 2 ? 3000 * attempt : 15000 * (attempt - 2);
      process.stdout.write(`\n  [retry ${attempt}/5] astept ${wait/1000}s...`);
      await sleep(wait);
    }
    try {
      const r = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(25000),
      });
      if (r.status === 429) {
        lastErr = new Error("MVX 429 (rate limit)");
        process.stdout.write(` 429`);
        continue;
      }
      if (r.status >= 500) {
        lastErr = new Error(`MVX ${r.status}`);
        process.stdout.write(` ${r.status}`);
        continue;
      }
      if (!r.ok) throw new Error(`MVX ${r.status} ${await r.text()}`);
      return r.json();
    } catch (err) {
      lastErr = err;
      if (attempt < 5) process.stdout.write(` err:${err.message.slice(0,60)}`);
    }
  }
  throw lastErr;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── entryToRow ───────────────────────────────────────────────

function entryToRow(e) {
  return {
    tx_hash:          e.txHash || (e.originalTxHash + ":" + (e.type || "scr")),
    original_tx_hash: e.originalTxHash || null,
    type:             e.type || null,
    sender:           e.sender || "",
    receiver:         e.receiver || "",
    ts:               Number(e.timestamp) || 0,
    function:         e.function || null,
    status:           e.status || "success",
    action_transfers: Array.isArray(e.action?.arguments?.transfers) ? e.action.arguments.transfers : null,
    operations:       Array.isArray(e.operations) ? e.operations : null,
  };
}

// ── Main ─────────────────────────────────────────────────────

async function getTotalCount() {
  const r = await fetch(`${MVX_API}/tokens/${TCL_TOKEN}/transfers/count`);
  return r.ok ? Number(await r.json()) : 0;
}

async function main() {
  console.log("=== TCL Bulk Sync ===");
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log("");

  // Citeste starea din Supabase
  const [offsetStr, cursorTsStr, doneStr] = await Promise.all([
    sbGetState("backfill_offset"),
    sbGetState("backfill_cursor_ts"),
    sbGetState("backfill_done"),
  ]);

  if (doneStr === "true") {
    console.log("Backfill deja COMPLET.");
    console.log("(Daca vrei sa re-rulezi: seteaza backfill_done=false in Supabase)");
    return;
  }

  let windowFrom = offsetStr ? parseInt(offsetStr, 10) : 0;
  let cursorTs   = cursorTsStr ? parseInt(cursorTsStr, 10) : null;

  const totalOnChain = await getTotalCount();
  const windowLabel  = cursorTs
    ? `fereastra curenta: before=${new Date(cursorTs*1000).toISOString().slice(0,19)}`
    : "fereastra initiala (fara cursor)";

  console.log(`Total pe blockchain : ${totalOnChain.toLocaleString()}`);
  console.log(`Offset in fereastra : ${windowFrom}  (${windowLabel})`);
  console.log(`Tinta               : pana la ${new Date(LISTING_TS*1000).toISOString().slice(0,10)}`);
  console.log("Ctrl+C opreste — la reluare continua de unde s-a oprit\n");

  let totalSynced = 0;
  let page        = 0;
  let windowMin   = Infinity;   // cel mai mic timestamp in fereastra curenta
  const startTime = Date.now();

  while (true) {
    // Asigura-te ca nu depasim limita MVX
    if (windowFrom + PAGE_SIZE > MAX_WINDOW) {
      // Trecem la urmatoarea fereastra folosind cursor timestamp
      cursorTs   = windowMin;
      windowFrom = 0;
      windowMin  = Infinity;
      await sbSet("backfill_cursor_ts", cursorTs);
      await sbSet("backfill_offset", 0);
      process.stdout.write(`\n  [fereastra noua] cursor_ts=${new Date(cursorTs*1000).toISOString().slice(0,19)}\n`);
    }

    let entries;
    try {
      entries = await mvxFetch(`/tokens/${TCL_TOKEN}/transfers`, {
        size:           PAGE_SIZE,
        from:           windowFrom,
        order:          "desc",
        status:         "success",
        withOperations: "true",
        before:         cursorTs,   // null la prima fereastra (ignored de mvxFetch)
      });
    } catch (err) {
      console.log(`\n\nEroare MVX API: ${err.message}`);
      await sbSet("backfill_offset", windowFrom).catch(() => {});
      if (cursorTs) await sbSet("backfill_cursor_ts", cursorTs).catch(() => {});
      console.log(`Progres salvat. Ruleaza din nou pentru a continua.`);
      process.exit(1);
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      console.log("\nNu mai sunt intrari — sync complet!");
      await sbSet("backfill_offset", windowFrom);
      await sbSet("backfill_done", "true");
      break;
    }

    const rows = entries.map(entryToRow);
    await sbUpsert("tcl_transfers", rows);
    totalSynced += rows.length;
    windowFrom  += PAGE_SIZE;
    page++;

    // Actualizeaza minimul de timestamp din fereastra curenta
    const pageMin = Math.min(...entries.map(e => Number(e.timestamp) || Infinity));
    if (pageMin < windowMin) windowMin = pageMin;

    // Salveaza progresul la fiecare 20 pagini
    if (page % 20 === 0) {
      await sbSet("backfill_offset", windowFrom);
      if (cursorTs) await sbSet("backfill_cursor_ts", cursorTs);
    }

    // Afisaj progress
    // Estimeaza pozitia globala: cursorTs ne da o idee de cand suntem
    const oldestTs  = cursorTs ?? (windowMin < Infinity ? windowMin : Date.now()/1000);
    const totalSpan = Date.now()/1000 - LISTING_TS;
    const doneSpan  = Date.now()/1000 - oldestTs;
    const pctTime   = Math.min(100, (doneSpan / totalSpan * 100)).toFixed(1);

    const elapsed = (Date.now() - startTime) / 1000;
    const rate    = Math.round(totalSynced / elapsed);
    const remaining = totalOnChain - (cursorTs ? (totalOnChain - windowFrom) : windowFrom);
    const etaSec  = Math.round(remaining / Math.max(1, rate));
    const etaMin  = Math.floor(etaSec / 60);
    const etaS    = etaSec % 60;

    process.stdout.write(
      `\r  P${page} | win_from=${windowFrom} | ~${pctTime}% timp | +${totalSynced.toLocaleString()} | ${rate} r/s | ETA ~${etaMin}m${etaS}s   `
    );

    // Verifica daca am ajuns la listing date
    if (pageMin <= LISTING_TS) {
      console.log("\n\nAtins data de listing (2024-06-13) — backfill COMPLET!");
      await sbSet("backfill_offset", windowFrom);
      await sbSet("backfill_cursor_ts", cursorTs ?? windowMin);
      await sbSet("backfill_done", "true");
      break;
    }

    if (entries.length < PAGE_SIZE) {
      console.log("\n\nUltima pagina — backfill COMPLET!");
      await sbSet("backfill_offset", windowFrom);
      await sbSet("backfill_done", "true");
      break;
    }

    await sleep(DELAY_MS);
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nGATA! ${totalSynced.toLocaleString()} intrari upsertate in ${totalSec}s`);
}

main().catch(err => {
  console.error("\nEROARE fatala:", err.message);
  process.exit(1);
});
