/**
 * TCL Holders Sync — server-side cron script
 * Snapshots the TCL token holder list into Postgres so the API can serve it
 * without hitting api.multiversx.com on every request (the VPS IP is rate-limited
 * there — see sync-pnl.js). The list lives ONLY on api.multiversx.com (the gateway
 * has no token/accounts view), so we fetch it once per run honoring Retry-After and
 * store the JSON snapshot in tcl_sync_state.
 *
 * Cron (suggested): every 15 min, offset from sync-pnl:
 *   3,18,33,48 * * * * node /opt/tcl-api/sync-holders.js >> /var/log/tcl-holders.log 2>&1
 */

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

const MVX_API   = "https://api.multiversx.com";
const TCL_TOKEN = "TCL-fe459d";
const SIZE      = Number(process.env.HOLDERS_SIZE) || 600;

const pool = new Pool({
  database: process.env.DB_NAME || "tcl_db",
  user:     process.env.DB_USER || "tcl_app",
  password: process.env.DB_PASSWORD,
  host:     process.env.DB_HOST || "127.0.0.1",
  port:     Number(process.env.DB_PORT) || 5432,
  max: 3,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Fetch honoring Cloudflare's Retry-After (api.multiversx.com 429 = CF 1015).
async function fetchHolders() {
  const url = `${MVX_API}/tokens/${TCL_TOKEN}/accounts?size=${SIZE}`;
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) {
        const ra = Number(r.headers.get("retry-after")) || 0;
        await sleep(Math.min(Math.max(ra * 1000, 5000), 30000));
        lastErr = new Error("MVX 429");
        continue;
      }
      if (!r.ok) { lastErr = new Error(`MVX ${r.status}`); continue; }
      const arr = await r.json();
      if (!Array.isArray(arr)) throw new Error("unexpected payload");
      return arr;
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error("fetchHolders failed");
}

async function main() {
  log("=== TCL Holders Sync START ===");
  const arr = await fetchHolders();
  // Keep only the fields the frontend needs, to bound the snapshot size.
  const slim = arr.map(h => ({ address: h.address, balance: h.balance }));
  const payload = JSON.stringify(slim);
  await pool.query(
    "INSERT INTO tcl_sync_state (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
    ["holders_snapshot", payload]
  );
  await pool.query(
    "INSERT INTO tcl_sync_state (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
    ["holders_updated_at", String(Math.floor(Date.now() / 1000))]
  );
  log(`=== DONE: stored ${slim.length} holders (${(payload.length / 1024).toFixed(1)} KB) ===`);
}

main()
  .catch(err => { log("ERROR:", err.message || err); process.exitCode = 1; })
  .finally(() => pool.end());
