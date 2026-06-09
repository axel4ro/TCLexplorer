/**
 * TCL Community API Server
 * Runs on the VPS, replaces all Cloudflare Workers
 * Direct PostgreSQL connection — no PostgREST overhead
 */

// Load .env file manually (no dotenv dependency needed)
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
} catch { /* .env optional */ }

import express from "express";
import pg from "pg";

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 4000;

// ── Database pool ─────────────────────────────────────────────────────────────
const pool = new Pool({
  database: process.env.DB_NAME || "tcl_db",
  user:     process.env.DB_USER || "tcl_app",
  password: process.env.DB_PASSWORD,
  host:     process.env.DB_HOST || "127.0.0.1",
  port:     Number(process.env.DB_PORT) || 5432,
  max: 20,
  idleTimeoutMillis: 30000,
});

// ── Config ────────────────────────────────────────────────────────────────────
const MVX_API = "https://api.multiversx.com";
const TCL_TOKEN = "TCL-fe459d";
const TCL_DECIMALS = 18n;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://tclexplorer.com,https://axel4ro.github.io").split(",").map(s => s.trim());

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Secret");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function utcDay()   { return new Date().toISOString().slice(0, 10); }
function utcMonth() { return new Date().toISOString().slice(0, 7);  }

function isValidWallet(addr) {
  return /^erd1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(String(addr || "").trim());
}

function formatTcl(raw) {
  if (!raw || raw === "0") return "0";
  const s = String(raw).padStart(Number(TCL_DECIMALS) + 1, "0");
  const whole = s.slice(0, -Number(TCL_DECIMALS)) || "0";
  const frac  = s.slice(-Number(TCL_DECIMALS)).replace(/0+$/, "").slice(0, 4);
  return frac ? `${whole}.${frac}` : whole;
}

function ticketNumber(month, id) {
  return `TCL-FREE-${month}-${String(id).padStart(6, "0")}`;
}

async function mvxAccount(address) {
  try {
    const r = await fetch(`${MVX_API}/accounts/${address}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

async function mvxTokenBalance(address, token) {
  try {
    const r = await fetch(`${MVX_API}/accounts/${address}/tokens/${token}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

// DB shorthand
const db = {
  query: (text, params) => pool.query(text, params),
  one:   async (text, params) => { const r = await pool.query(text, params); return r.rows[0] || null; },
  all:   async (text, params) => { const r = await pool.query(text, params); return r.rows; },
};

const ok   = (res, data, status = 200)  => res.status(status).json(data);
const fail = (res, msg, status = 400)   => res.status(status).json({ ok: false, error: msg });

function adminAuth(req, res) {
  const secret = req.headers["x-admin-secret"] || "";
  if (!secret || secret !== ADMIN_SECRET) {
    fail(res, "Unauthorized.", 401);
    return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
//  WHEEL API  —  /wheel/*
// ══════════════════════════════════════════════════════════════════════════════

const wheel = express.Router();

// GET /wheel/config
wheel.get("/config", async (req, res) => {
  try {
    const cfg = await db.one(
      "SELECT wheel_wallet, host_herotag, host_wallet, token_identifier, enabled, prize_split FROM wheel_config LIMIT 1"
    );
    ok(res, { ok: true, config: cfg || null, month: utcMonth() });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// GET /wheel/pool
wheel.get("/pool", async (req, res) => {
  try {
    const cfg = await db.one("SELECT wheel_wallet FROM wheel_config LIMIT 1");
    const wallet = cfg?.wheel_wallet;
    if (!wallet) return ok(res, { ok: true, balance: "0", formatted: "0", wallet: "" });
    const info = await mvxTokenBalance(wallet, TCL_TOKEN);
    const raw  = info?.balance || "0";
    ok(res, { ok: true, balance: raw, formatted: formatTcl(raw), decimals: Number(TCL_DECIMALS), wallet });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// POST /wheel/eligibility
wheel.post("/eligibility", async (req, res) => {
  try {
    const wallet = String(req.body?.wallet || "").trim();
    if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");

    const cfg = await db.one("SELECT enabled FROM wheel_config LIMIT 1");
    if (!cfg?.enabled) return ok(res, { ok: true, eligible: false, reason: "Wheel is not active this month." });

    const today = utcDay();
    const dup = await db.one(
      "SELECT ticket_number FROM wheel_tickets WHERE wallet_address=$1 AND ticket_day=$2 LIMIT 1",
      [wallet, today]
    );
    if (dup) return ok(res, { ok: true, eligible: false, reason: "Already claimed today.", ticket: dup.ticket_number });

    const account  = await mvxAccount(wallet);
    const herotag  = account?.username || "";
    if (!herotag) return ok(res, { ok: true, eligible: false, reason: "HeroTag required. Register one at xPortal." });

    ok(res, { ok: true, eligible: true, herotag });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// POST /wheel/claim
wheel.post("/claim", async (req, res) => {
  try {
    const wallet = String(req.body?.wallet || "").trim();
    if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");

    const cfg = await db.one("SELECT enabled FROM wheel_config LIMIT 1");
    if (!cfg?.enabled) return fail(res, "Wheel is not active this month.", 403);

    const account = await mvxAccount(wallet);
    const herotag = account?.username || "";
    if (!herotag) return fail(res, "HeroTag required. Register one at xPortal.", 403);

    const today = utcDay();
    const month = today.slice(0, 7);

    // Idempotent
    const dup = await db.one(
      "SELECT id, ticket_number FROM wheel_tickets WHERE wallet_address=$1 AND ticket_day=$2 LIMIT 1",
      [wallet, today]
    );
    if (dup) return ok(res, { ok: true, already: true, ticket: dup.ticket_number, herotag, day: today, month });

    // Insert + get id in one round-trip
    const row = await db.one(
      `INSERT INTO wheel_tickets (raffle_month, wallet_address, herotag, ticket_day, ticket_number, status)
       VALUES ($1,$2,$3,$4,$5,'valid') RETURNING id`,
      [month, wallet, herotag, today, `TCL-FREE-${month}-PENDING-${Date.now()}`]
    );
    if (!row?.id) return fail(res, "Ticket creation failed.", 500);

    const tn = ticketNumber(month, row.id);
    await db.query("UPDATE wheel_tickets SET ticket_number=$1 WHERE id=$2", [tn, row.id]);

    // Audit log (fire and forget)
    db.query(
      "INSERT INTO wheel_audit_logs (action, wallet_address, data) VALUES ($1,$2,$3)",
      ["claim_ticket", wallet, JSON.stringify({ ticket_number: tn, herotag, ticket_day: today, month })]
    ).catch(() => {});

    ok(res, { ok: true, ticket: tn, herotag, wallet, day: today, month });
  } catch (e) {
    if (e.code === "23505") {
      // Unique violation — race condition, already claimed
      const dup = await db.one(
        "SELECT ticket_number FROM wheel_tickets WHERE wallet_address=$1 AND ticket_day=$2 LIMIT 1",
        [req.body?.wallet, utcDay()]
      ).catch(() => null);
      return ok(res, { ok: true, already: true, ticket: dup?.ticket_number, day: utcDay(), month: utcMonth() });
    }
    fail(res, "Server error.", 500); console.error(e);
  }
});

// GET /wheel/tickets?wallet=&month=
wheel.get("/tickets", async (req, res) => {
  try {
    const wallet = String(req.query.wallet || "").trim();
    if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");
    const month = req.query.month || utcMonth();
    const tickets = await db.all(
      "SELECT ticket_number, ticket_day, status FROM wheel_tickets WHERE wallet_address=$1 AND raffle_month=$2 ORDER BY id ASC",
      [wallet, month]
    );
    ok(res, { ok: true, tickets, month });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// GET /wheel/contributors?month=
wheel.get("/contributors", async (req, res) => {
  try {
    const month = req.query.month || utcMonth();
    const contributors = await db.all(
      "SELECT herotag, wallet_address, amount_tcl, created_at FROM wheel_contributions WHERE raffle_month=$1 ORDER BY amount_tcl DESC LIMIT 50",
      [month]
    );
    ok(res, { ok: true, contributors, month });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// GET /wheel/winners?month=
wheel.get("/winners", async (req, res) => {
  try {
    const month = req.query.month || utcMonth();
    const winners = await db.all(
      "SELECT place, herotag, wallet_address, ticket_number, reward_tcl, paid_status FROM wheel_winners WHERE raffle_month=$1 ORDER BY place ASC",
      [month]
    );
    ok(res, { ok: true, winners, month });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// GET /wheel/herotag?wallet=  — auto-lookup for admin panel
wheel.get("/herotag", async (req, res) => {
  try {
    const wallet = String(req.query.wallet || "").trim();
    if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");
    const account = await mvxAccount(wallet);
    const herotag = account?.username || "";
    ok(res, { ok: true, herotag, wallet });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// POST /wheel/admin/draw
wheel.post("/admin/draw", async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const month = String(req.body?.month || utcMonth()).trim();

    const existing = await db.one("SELECT id FROM wheel_winners WHERE raffle_month=$1 LIMIT 1", [month]);
    if (existing) return fail(res, `Winners already drawn for ${month}.`, 409);

    const tickets = await db.all(
      "SELECT id, ticket_number, wallet_address, herotag FROM wheel_tickets WHERE raffle_month=$1 AND status='valid'",
      [month]
    );
    if (!tickets || tickets.length < 3) return fail(res, `Not enough tickets (${tickets?.length || 0}). Need at least 3.`, 400);

    const cfg = await db.one("SELECT wheel_wallet, prize_split FROM wheel_config LIMIT 1");
    const tokenInfo = await mvxTokenBalance(cfg?.wheel_wallet, TCL_TOKEN);
    const poolRaw   = BigInt(tokenInfo?.balance || "0");
    const split     = cfg?.prize_split || { first: 50, second: 30, third: 20 };
    const rewards   = [
      (poolRaw * BigInt(split.first))  / 100n,
      (poolRaw * BigInt(split.second)) / 100n,
      (poolRaw * BigInt(split.third))  / 100n,
    ];

    // Crypto-random draw — 3 unique
    const pool2 = [...tickets];
    const chosen = [];
    for (let i = 0; i < 3; i++) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      const idx = buf[0] % pool2.length;
      chosen.push(pool2.splice(idx, 1)[0]);
    }

    for (let i = 0; i < 3; i++) {
      await db.query(
        `INSERT INTO wheel_winners (raffle_month, place, ticket_id, ticket_number, wallet_address, herotag, reward_tcl, paid_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'unpaid')`,
        [month, i + 1, chosen[i].id, chosen[i].ticket_number, chosen[i].wallet_address, chosen[i].herotag, rewards[i].toString()]
      );
    }

    db.query(
      "INSERT INTO wheel_audit_logs (action, wallet_address, data) VALUES ($1,NULL,$2)",
      ["draw_winners", JSON.stringify({ month, total_tickets: tickets.length, chosen: chosen.map(t => t.ticket_number) })]
    ).catch(() => {});

    ok(res, {
      ok: true, month,
      winners: chosen.map((t, i) => ({
        place: i + 1, ticket: t.ticket_number, wallet: t.wallet_address,
        herotag: t.herotag, reward_tcl: formatTcl(rewards[i].toString()),
      })),
    });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// POST /wheel/admin/mark-paid
wheel.post("/admin/mark-paid", async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const { month, place, tx_hash } = req.body || {};
    if (!month || !place) return fail(res, "month and place required.");
    await db.query(
      "UPDATE wheel_winners SET paid_status='paid', paid_tx_hash=$1 WHERE raffle_month=$2 AND place=$3",
      [tx_hash || null, month, place]
    );
    ok(res, { ok: true });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// POST /wheel/admin/update-config
wheel.post("/admin/update-config", async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const b = req.body || {};
    const fields = [];
    const vals   = [];
    let i = 1;
    if (b.wheel_wallet  !== undefined) { fields.push(`wheel_wallet=$${i++}`);  vals.push(b.wheel_wallet); }
    if (b.host_herotag  !== undefined) { fields.push(`host_herotag=$${i++}`);  vals.push(b.host_herotag); }
    if (b.host_wallet   !== undefined) { fields.push(`host_wallet=$${i++}`);   vals.push(b.host_wallet); }
    if (b.enabled       !== undefined) { fields.push(`enabled=$${i++}`);       vals.push(Boolean(b.enabled)); }
    if (b.prize_split   !== undefined) { fields.push(`prize_split=$${i++}`);   vals.push(JSON.stringify(b.prize_split)); }
    fields.push(`updated_at=$${i++}`);
    vals.push(new Date().toISOString());
    if (fields.length > 1) await db.query(`UPDATE wheel_config SET ${fields.join(",")}`, vals);
    ok(res, { ok: true });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// GET /wheel/admin/tickets?month=
wheel.get("/admin/tickets", async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const month = req.query.month || utcMonth();
    const tickets = await db.all(
      "SELECT ticket_number, wallet_address, herotag, ticket_day, status FROM wheel_tickets WHERE raffle_month=$1 ORDER BY id ASC",
      [month]
    );
    ok(res, { ok: true, tickets, month });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// POST /wheel/admin/add-contribution
wheel.post("/admin/add-contribution", async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const { wallet, herotag, amount_tcl, tx_hash, month } = req.body || {};
    if (!wallet || !tx_hash || !amount_tcl) return fail(res, "wallet, tx_hash, amount_tcl required.");
    await db.query(
      "INSERT INTO wheel_contributions (raffle_month, wallet_address, herotag, tx_hash, amount_tcl) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tx_hash) DO NOTHING",
      [month || utcMonth(), wallet, herotag || "", tx_hash, String(amount_tcl)]
    );
    ok(res, { ok: true });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

app.use("/wheel", wheel);

// ══════════════════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ══════════════════════════════════════════════════════════════════════════════
app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, uptime: process.uptime().toFixed(0) + "s", time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
pool.connect().then(client => {
  client.release();
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`TCL API listening on http://127.0.0.1:${PORT}`);
  });
}).catch(err => {
  console.error("DB connection failed:", err.message);
  process.exit(1);
});
