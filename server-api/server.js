/**
 * TCL Community API Server
 * Runs on the VPS, replaces all Cloudflare Workers
 * Direct PostgreSQL connection — no PostgREST overhead
 */

// Load .env file manually (no dotenv dependency needed)
import { readFileSync, statSync } from "fs";
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
import { createHash, createHmac, randomBytes } from "crypto";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import {
  Account,
  Address,
  Message,
  MessageComputer,
  Token,
  TokenTransfer,
  TransactionComputer,
  TransactionsFactoryConfig,
  TransferTransactionsFactory,
  UserVerifier,
} from "@multiversx/sdk-core";
import { computeWalletSwapPnl, computeWalletEarned } from "./pnl-compute.mjs";

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
const MVX_GATEWAY = process.env.MVX_GATEWAY || "https://gateway.multiversx.com";
const MVX_CHAIN_ID = process.env.MVX_CHAIN_ID || "1";
const TCL_TOKEN = "TCL-fe459d";
const TCL_DECIMALS = 18n;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const WHEEL_PAYOUT_PEM_PATH = process.env.WHEEL_PAYOUT_PEM_PATH || "";
const ALLOWED_ORIGINS = [...new Set([
  ...(process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),
  "https://tclexplorer.com",
  "https://www.tclexplorer.com",
  "https://axel4ro.github.io",
])];
const WHEEL_DRAW_INTERVAL_MS = 60 * 1000;
const WHEEL_ENTRY_DOMAIN = "tclexplorer.com";
const WHEEL_PAYOUT_PENDING_STATUSES = ["submitting", "submitted"];
let wheelPayoutAccountPromise = null;

// ── Middleware ────────────────────────────────────────────────────────────────
// Trust Cloudflare as the single upstream proxy — gives correct req.ip
app.set("trust proxy", 1);

app.use(express.json());

// Security headers
app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));

// Rate limiters — keyed by CF-Connecting-IP (real client IP set by Cloudflare)
const cfIp = (req) => req.headers["cf-connecting-ip"] || req.ip;

// General: 120 req/min — covers any normal browsing pattern
const generalLimiter = rateLimit({
  windowMs: 60_000, max: 120, keyGenerator: cfIp,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests, please slow down." }
});

// Heavy: endpoints that hit DB or external APIs — 30 req/min
const heavyLimiter = rateLimit({
  windowMs: 60_000, max: 30, keyGenerator: cfIp,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests to this endpoint." }
});

// Write: POST endpoints — 20 req/min
const writeLimiter = rateLimit({
  windowMs: 60_000, max: 20, keyGenerator: cfIp,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many write requests, please slow down." }
});

app.use("/api", generalLimiter);
app.use(["/api/analytics", "/api/leaderboard", "/api/technicals", "/api/volume"], heavyLimiter);
app.use((req, res, next) => { if (req.method === "POST") return writeLimiter(req, res, next); next(); });

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

function isValidMonth(value) {
  return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function isValidCountryCode(value) {
  return /^[A-Z]{2}$/.test(String(value || ""));
}

function publicCampaign(campaign) {
  if (!campaign) return null;
  return {
    month: campaign.month,
    title: campaign.title,
    status: campaign.status,
    starts_at: campaign.starts_at,
    closes_at: campaign.closes_at,
    draw_at: campaign.draw_at,
    min_age: campaign.min_age,
    eligible_countries: campaign.eligible_countries || [],
    rules_version: campaign.rules_version,
    rules_url: campaign.rules_url,
    privacy_url: campaign.privacy_url,
    rules_hash: campaign.rules_hash,
    organizer_name: campaign.organizer_name,
    organizer_address: campaign.organizer_address,
    organizer_email: campaign.organizer_email,
    prize_amounts: campaign.prize_amounts,
    prize_arv_ron: campaign.prize_arv_ron,
    automatic_draw: campaign.automatic_draw,
  };
}

function buildWheelEntryMessage({ wallet, campaign, ticketDay, countryCode }) {
  return [
    "TCL Explorer Free Monthly Giveaway Entry",
    `Domain: ${WHEEL_ENTRY_DOMAIN}`,
    `Wallet: ${wallet}`,
    `Campaign: ${campaign.month}`,
    `Entry day (UTC): ${ticketDay}`,
    `Country: ${countryCode}`,
    `Age confirmation: ${campaign.min_age}+`,
    `Rules version: ${campaign.rules_version}`,
    `Rules SHA-256: ${campaign.rules_hash}`,
    "No purchase or donation is required.",
  ].join("\n");
}

async function verifyWalletMessageSignature(wallet, messageText, signatureHex, context) {
  if (!/^[0-9a-f]{128}$/i.test(String(signatureHex || ""))) return false;
  try {
    const address = Address.newFromBech32(wallet);
    const message = new Message({
      data: new Uint8Array(Buffer.from(messageText, "utf8")),
      address,
    });
    const serialized = new MessageComputer().computeBytesForVerifying(message);
    const verifier = UserVerifier.fromAddress(address);
    return await verifier.verify(serialized, Buffer.from(signatureHex, "hex"));
  } catch (error) {
    console.warn(`${context} signature verification failed:`, error?.message || error);
    return false;
  }
}

async function verifyWheelEntrySignature(wallet, messageText, signatureHex) {
  return verifyWalletMessageSignature(wallet, messageText, signatureHex, "Wheel entry");
}

function buildWheelPrizeClaimMessage(winner) {
  return [
    "TCL Explorer Giveaway Prize Claim",
    `Domain: ${WHEEL_ENTRY_DOMAIN}`,
    `Wallet: ${winner.wallet_address}`,
    `Campaign: ${winner.raffle_month}`,
    `Place: ${winner.place}`,
    `Ticket: ${winner.ticket_number}`,
    `Token: ${TCL_TOKEN}`,
    `Reward (raw 18 decimals): ${winner.reward_tcl}`,
    "Claim version: 1",
    "I authorize the prize payout to the wallet above.",
  ].join("\n");
}

async function getWheelPayoutAccount() {
  if (!WHEEL_PAYOUT_PEM_PATH) {
    throw wheelDrawError("Prize payouts are not configured on the server.", 503);
  }
  if (!wheelPayoutAccountPromise) {
    wheelPayoutAccountPromise = Account.newFromPem(WHEEL_PAYOUT_PEM_PATH);
  }
  try {
    return await wheelPayoutAccountPromise;
  } catch (error) {
    wheelPayoutAccountPromise = null;
    console.error("Could not load wheel payout account:", error?.message || error);
    throw wheelDrawError("Prize payouts are temporarily unavailable.", 503);
  }
}

async function wheelPayoutReadiness(wheelWallet) {
  if (!WHEEL_PAYOUT_PEM_PATH || !isValidWallet(wheelWallet)) return false;
  try {
    const payoutAccount = await getWheelPayoutAccount();
    return payoutAccount.address.toBech32() === wheelWallet;
  } catch {
    return false;
  }
}

async function fetchMvxJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(12000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { response, data, text };
}

async function broadcastWheelPayout(transactionPayload) {
  const { response, data, text } = await fetchMvxJson(`${MVX_GATEWAY}/transaction/send`, {
    method: "POST",
    body: JSON.stringify(transactionPayload),
  });
  const txHash = data?.txHash || data?.data?.txHash || "";
  if (!response.ok || !txHash) {
    const message = data?.error || data?.message || data?.data?.message || text || `HTTP ${response.status}`;
    throw new Error(`MultiversX broadcast failed: ${message}`);
  }
  return txHash;
}

async function getWheelPayoutTransaction(txHash) {
  const { response, data, text } = await fetchMvxJson(
    `${MVX_API}/transactions/${encodeURIComponent(txHash)}?withResults=true`
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(data?.message || text || `Could not query transaction ${txHash}.`);
  }
  return data;
}

async function getWheelCampaign(month = utcMonth(), client = db) {
  return client.one(
    `SELECT month, title, status, starts_at, closes_at, draw_at, min_age,
            eligible_countries, rules_version, rules_url, privacy_url, rules_hash,
            organizer_name, organizer_address, organizer_email, prize_amounts,
            prize_arv_ron, automatic_draw
       FROM wheel_campaigns
      WHERE month=$1
      LIMIT 1`,
    [month]
  );
}

function wheelCampaignAvailability(campaign, now = new Date()) {
  if (!campaign) return { open: false, reason: "This month's giveaway has not been configured." };
  if (campaign.status !== "open") {
    return { open: false, reason: campaign.status === "drawn" ? "This giveaway has already been drawn." : "Entries are not open." };
  }
  if (now < new Date(campaign.starts_at)) return { open: false, reason: "Entries have not opened yet." };
  if (now >= new Date(campaign.closes_at)) return { open: false, reason: "Entries are closed for this giveaway." };
  return { open: true, reason: "" };
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
    const month = utcMonth();
    const [cfg, campaign] = await Promise.all([
      db.one("SELECT wheel_wallet, host_herotag, host_wallet, token_identifier, enabled, prize_split FROM wheel_config LIMIT 1"),
      getWheelCampaign(month),
    ]);
    const config = cfg
      ? { ...cfg, payout_ready: await wheelPayoutReadiness(cfg.wheel_wallet), payout_mode: "winner_claim" }
      : null;
    ok(res, { ok: true, config, campaign: publicCampaign(campaign), month });
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

    const month = utcMonth();
    const [cfg, campaign] = await Promise.all([
      db.one("SELECT enabled FROM wheel_config LIMIT 1"),
      getWheelCampaign(month),
    ]);
    if (!cfg?.enabled) return ok(res, { ok: true, eligible: false, reason: "Wheel is not active this month." });
    const availability = wheelCampaignAvailability(campaign);
    if (!availability.open) return ok(res, { ok: true, eligible: false, reason: availability.reason, campaign: publicCampaign(campaign) });

    const today = utcDay();
    const dup = await db.one(
      "SELECT ticket_number FROM wheel_tickets WHERE wallet_address=$1 AND ticket_day=$2 LIMIT 1",
      [wallet, today]
    );
    if (dup) return ok(res, { ok: true, eligible: false, reason: "Already claimed today.", ticket: dup.ticket_number });

    const account  = await mvxAccount(wallet);
    const herotag  = account?.username || "";
    if (!herotag) return ok(res, { ok: true, eligible: false, reason: "HeroTag required. Register one at xPortal." });

    ok(res, {
      ok: true,
      eligible: true,
      herotag,
      ticket_day: today,
      campaign: publicCampaign(campaign),
    });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// POST /wheel/entry-message
wheel.post("/entry-message", async (req, res) => {
  try {
    const wallet = String(req.body?.wallet || "").trim();
    const countryCode = String(req.body?.country_code || "").trim().toUpperCase();
    const ageConfirmed = req.body?.age_confirmed === true;
    const rulesVersion = String(req.body?.rules_version || "").trim();
    if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");

    const campaign = await getWheelCampaign(utcMonth());
    const availability = wheelCampaignAvailability(campaign);
    if (!availability.open) return fail(res, availability.reason, 403);
    if (!ageConfirmed) return fail(res, `You must confirm that you are at least ${campaign.min_age}.`, 403);
    if (!isValidCountryCode(countryCode) || !campaign.eligible_countries?.includes(countryCode)) {
      return fail(res, "Your country is not eligible for this giveaway.", 403);
    }
    if (rulesVersion !== campaign.rules_version) return fail(res, "The giveaway rules have changed.", 409);

    const ticketDay = utcDay();
    ok(res, {
      ok: true,
      message: buildWheelEntryMessage({ wallet, campaign, ticketDay, countryCode }),
      ticket_day: ticketDay,
      campaign: publicCampaign(campaign),
    });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// POST /wheel/claim
wheel.post("/claim", async (req, res) => {
  try {
    const wallet = String(req.body?.wallet || "").trim();
    if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");

    const countryCode = String(req.body?.country_code || "").trim().toUpperCase();
    const ageConfirmed = req.body?.age_confirmed === true;
    const rulesVersion = String(req.body?.rules_version || "").trim();
    const entryMessage = String(req.body?.message || "");
    const entrySignature = String(req.body?.signature || "").trim();

    const month = utcMonth();
    const [cfg, campaign] = await Promise.all([
      db.one("SELECT enabled FROM wheel_config LIMIT 1"),
      getWheelCampaign(month),
    ]);
    if (!cfg?.enabled) return fail(res, "Wheel is not active this month.", 403);
    const availability = wheelCampaignAvailability(campaign);
    if (!availability.open) return fail(res, availability.reason, 403);
    if (!ageConfirmed) return fail(res, `You must confirm that you are at least ${campaign.min_age}.`, 403);
    if (!isValidCountryCode(countryCode) || !campaign.eligible_countries?.includes(countryCode)) {
      return fail(res, "Your country is not eligible for this giveaway.", 403);
    }
    if (rulesVersion !== campaign.rules_version) return fail(res, "The giveaway rules have changed. Review and accept the current rules.", 409);

    const account = await mvxAccount(wallet);
    const herotag = account?.username || "";
    if (!herotag) return fail(res, "HeroTag required. Register one at xPortal.", 403);

    const today = utcDay();
    const expectedMessage = buildWheelEntryMessage({ wallet, campaign, ticketDay: today, countryCode });
    if (entryMessage !== expectedMessage) return fail(res, "The signed entry message is invalid.", 400);
    if (!await verifyWheelEntrySignature(wallet, entryMessage, entrySignature)) {
      return fail(res, "The xPortal signature could not be verified.", 403);
    }

    // Idempotent
    const dup = await db.one(
      "SELECT id, ticket_number FROM wheel_tickets WHERE wallet_address=$1 AND ticket_day=$2 LIMIT 1",
      [wallet, today]
    );
    if (dup) return ok(res, { ok: true, already: true, ticket: dup.ticket_number, herotag, day: today, month });

    // Insert + get id in one round-trip
    const row = await db.one(
      `INSERT INTO wheel_tickets
        (raffle_month, wallet_address, herotag, ticket_day, ticket_number, status,
         rules_version, country_code, age_confirmed, accepted_at, entry_message, entry_signature)
       VALUES ($1,$2,$3,$4,$5,'valid',$6,$7,true,NOW(),$8,$9)
       RETURNING id`,
      [
        month, wallet, herotag, today, `TCL-FREE-${month}-PENDING-${Date.now()}`,
        campaign.rules_version, countryCode, entryMessage, entrySignature,
      ]
    );
    if (!row?.id) return fail(res, "Ticket creation failed.", 500);

    const tn = ticketNumber(month, row.id);
    await db.query("UPDATE wheel_tickets SET ticket_number=$1 WHERE id=$2", [tn, row.id]);

    // Audit log (fire and forget)
    db.query(
      "INSERT INTO wheel_audit_logs (action, wallet_address, data) VALUES ($1,$2,$3)",
      ["claim_ticket", wallet, JSON.stringify({
        ticket_number: tn,
        herotag,
        ticket_day: today,
        month,
        country_code: countryCode,
        rules_version: campaign.rules_version,
        rules_hash: campaign.rules_hash,
        signature_verified: true,
      })]
    ).catch(() => {});

    ok(res, { ok: true, ticket: tn, herotag, wallet, day: today, month, rules_version: campaign.rules_version });
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
      `SELECT place, herotag, wallet_address, ticket_number, reward_tcl, paid_status,
              paid_tx_hash, payout_confirmed_at, payout_error, draw_proof
         FROM wheel_winners
        WHERE raffle_month=$1
        ORDER BY place ASC`,
      [month]
    );
    ok(res, { ok: true, winners, month });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// POST /wheel/prize-claim-message
wheel.post("/prize-claim-message", async (req, res) => {
  try {
    const wallet = String(req.body?.wallet || "").trim();
    const month = String(req.body?.month || utcMonth()).trim();
    const place = Number(req.body?.place);
    if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");
    if (!isValidMonth(month)) return fail(res, "Invalid month. Use YYYY-MM.");
    if (![1, 2, 3].includes(place)) return fail(res, "Invalid winner place.");

    const winner = await db.one(
      `SELECT raffle_month, place, ticket_number, wallet_address, reward_tcl,
              paid_status, paid_tx_hash, payout_confirmed_at
         FROM wheel_winners
        WHERE raffle_month=$1 AND place=$2
        LIMIT 1`,
      [month, place]
    );
    if (!winner) return fail(res, "Winner not found.", 404);
    if (winner.wallet_address !== wallet) return fail(res, "This wallet is not the selected winner.", 403);
    if (winner.paid_status === "paid") {
      return ok(res, {
        ok: true,
        status: "paid",
        tx_hash: winner.paid_tx_hash,
        confirmed_at: winner.payout_confirmed_at,
      });
    }
    if (WHEEL_PAYOUT_PENDING_STATUSES.includes(winner.paid_status)) {
      return ok(res, { ok: true, status: "submitted", tx_hash: winner.paid_tx_hash });
    }

    const cfg = await db.one("SELECT wheel_wallet FROM wheel_config LIMIT 1");
    if (!await wheelPayoutReadiness(cfg?.wheel_wallet)) {
      return fail(res, "Prize payout wallet is not ready yet.", 503);
    }
    ok(res, {
      ok: true,
      status: winner.paid_status,
      message: buildWheelPrizeClaimMessage(winner),
      reward_tcl: winner.reward_tcl,
      token_identifier: TCL_TOKEN,
    });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// POST /wheel/prize-claim
wheel.post("/prize-claim", async (req, res) => {
  const wallet = String(req.body?.wallet || "").trim();
  const month = String(req.body?.month || utcMonth()).trim();
  const place = Number(req.body?.place);
  const message = String(req.body?.message || "");
  const signature = String(req.body?.signature || "").trim();
  if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");
  if (!isValidMonth(month)) return fail(res, "Invalid month. Use YYYY-MM.");
  if (![1, 2, 3].includes(place)) return fail(res, "Invalid winner place.");

  let client;
  let transactionPayload;
  let computedTxHash;
  try {
    const initialWinner = await db.one(
      `SELECT raffle_month, place, ticket_number, wallet_address, reward_tcl, paid_status
         FROM wheel_winners
        WHERE raffle_month=$1 AND place=$2
        LIMIT 1`,
      [month, place]
    );
    if (!initialWinner) return fail(res, "Winner not found.", 404);
    if (initialWinner.wallet_address !== wallet) return fail(res, "This wallet is not the selected winner.", 403);
    const expectedMessage = buildWheelPrizeClaimMessage(initialWinner);
    if (message !== expectedMessage) return fail(res, "Prize claim message is invalid.");
    if (!await verifyWalletMessageSignature(wallet, message, signature, "Wheel prize claim")) {
      return fail(res, "Invalid prize claim signature.", 401);
    }

    const payoutAccount = await getWheelPayoutAccount();
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["wheel-payout-wallet"]);

    const cfgResult = await client.query(
      "SELECT wheel_wallet, token_identifier FROM wheel_config LIMIT 1 FOR UPDATE"
    );
    const cfg = cfgResult.rows[0];
    const payoutWallet = payoutAccount.address.toBech32();
    if (!cfg || cfg.wheel_wallet !== payoutWallet) {
      throw wheelDrawError("Configured wheel wallet does not match the server payout key.", 503);
    }
    if (cfg.token_identifier !== TCL_TOKEN) {
      throw wheelDrawError("Configured payout token does not match TCL.", 503);
    }

    const winnerResult = await client.query(
      `SELECT id, raffle_month, place, ticket_number, wallet_address, reward_tcl,
              paid_status, paid_tx_hash
         FROM wheel_winners
        WHERE raffle_month=$1 AND place=$2
        FOR UPDATE`,
      [month, place]
    );
    const winner = winnerResult.rows[0];
    if (!winner || winner.wallet_address !== wallet) {
      throw wheelDrawError("Winner record changed. Please refresh.", 409);
    }
    if (winner.paid_status === "paid") {
      await client.query("COMMIT");
      return ok(res, { ok: true, status: "paid", tx_hash: winner.paid_tx_hash });
    }
    if (WHEEL_PAYOUT_PENDING_STATUSES.includes(winner.paid_status)) {
      await client.query("COMMIT");
      return ok(res, { ok: true, status: "submitted", tx_hash: winner.paid_tx_hash });
    }
    if (message !== buildWheelPrizeClaimMessage(winner)) {
      throw wheelDrawError("Prize claim details changed. Please sign a new claim.", 409);
    }

    const pendingResult = await client.query(
      `SELECT id
         FROM wheel_winners
        WHERE paid_status = ANY($1::text[])
          AND NOT (raffle_month=$2 AND place=$3)
        LIMIT 1`,
      [WHEEL_PAYOUT_PENDING_STATUSES, month, place]
    );
    if (pendingResult.rows[0]) {
      throw wheelDrawError("Another prize payout is being confirmed. Please try again shortly.", 409);
    }

    const reward = BigInt(winner.reward_tcl || "0");
    if (reward <= 0n) throw wheelDrawError("This prize has no payable TCL amount.", 409);
    const [accountInfo, tokenInfo] = await Promise.all([
      mvxAccount(payoutWallet),
      mvxTokenBalance(payoutWallet, TCL_TOKEN),
    ]);
    if (!accountInfo) throw wheelDrawError("Could not read the payout wallet from MultiversX.", 503);
    if (accountInfo.isGuarded) {
      throw wheelDrawError("The payout wallet is guarded and cannot be used by the automatic signer.", 503);
    }
    if (BigInt(tokenInfo?.balance || "0") < reward) {
      throw wheelDrawError("The payout wallet does not have enough TCL for this prize.", 503);
    }

    const factory = new TransferTransactionsFactory({
      config: new TransactionsFactoryConfig({ chainID: MVX_CHAIN_ID }),
    });
    const transaction = await factory.createTransactionForESDTTokenTransfer(
      payoutAccount.address,
      {
        receiver: Address.newFromBech32(wallet),
        tokenTransfers: [
          new TokenTransfer({
            token: new Token({ identifier: TCL_TOKEN }),
            amount: reward,
          }),
        ],
      }
    );
    transaction.nonce = BigInt(accountInfo.nonce);
    const maximumFee = transaction.gasLimit * transaction.gasPrice;
    if (BigInt(accountInfo.balance || "0") < maximumFee) {
      throw wheelDrawError("The payout wallet needs more EGLD for transaction fees.", 503);
    }
    transaction.signature = await payoutAccount.signTransaction(transaction);
    transactionPayload = transaction.toSendable();
    computedTxHash = new TransactionComputer().computeTransactionHash(transaction);

    await client.query(
      `UPDATE wheel_winners
          SET paid_status='submitted',
              paid_tx_hash=$1,
              claim_message=$2,
              claim_signature=$3,
              claim_requested_at=NOW(),
              payout_tx=$4,
              payout_submitted_at=NOW(),
              payout_confirmed_at=NULL,
              payout_last_checked_at=NULL,
              payout_error=NULL
        WHERE id=$5`,
      [computedTxHash, message, signature, JSON.stringify(transactionPayload), winner.id]
    );
    await client.query(
      "INSERT INTO wheel_audit_logs (action, wallet_address, data) VALUES ($1,$2,$3)",
      ["prize_claim_submitted", wallet, JSON.stringify({
        month,
        place,
        reward_tcl: winner.reward_tcl,
        tx_hash: computedTxHash,
      })]
    );
    await client.query("COMMIT");

    try {
      const broadcastHash = await broadcastWheelPayout(transactionPayload);
      if (broadcastHash !== computedTxHash) {
        console.warn(`Wheel payout hash mismatch: computed=${computedTxHash} gateway=${broadcastHash}`);
      }
    } catch (error) {
      console.error(`Wheel payout queued for retry ${computedTxHash}:`, error?.message || error);
      await db.query(
        "UPDATE wheel_winners SET payout_error=$1 WHERE raffle_month=$2 AND place=$3 AND paid_tx_hash=$4",
        [String(error?.message || error).slice(0, 1000), month, place, computedTxHash]
      ).catch(() => {});
    }

    ok(res, {
      ok: true,
      status: "submitted",
      tx_hash: computedTxHash,
      explorer_url: `https://explorer.multiversx.com/transactions/${computedTxHash}`,
    }, 202);
  } catch (e) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    fail(res, e?.status ? e.message : "Prize payout could not be prepared.", e?.status || 500);
    console.error(e);
  } finally {
    client?.release();
  }
});

// GET /wheel/draw-proof?month=
wheel.get("/draw-proof", async (req, res) => {
  try {
    const month = String(req.query.month || utcMonth()).trim();
    if (!isValidMonth(month)) return fail(res, "Invalid month. Use YYYY-MM.");
    const [winner, tickets] = await Promise.all([
      db.one(
        "SELECT draw_proof FROM wheel_winners WHERE raffle_month=$1 AND place=1 LIMIT 1",
        [month]
      ),
      db.all(
        "SELECT id, ticket_number FROM wheel_tickets WHERE raffle_month=$1 AND status='valid' ORDER BY id ASC",
        [month]
      ),
    ]);
    if (!winner?.draw_proof) return fail(res, `No completed draw proof for ${month}.`, 404);
    ok(res, {
      ok: true,
      month,
      proof: winner.draw_proof,
      tickets: tickets.map((ticket) => ({ id: String(ticket.id), ticket_number: ticket.ticket_number })),
    });
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

function wheelDrawError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function wheelDrawRewards(campaign, poolRaw, split) {
  const configured = campaign?.prize_amounts || {};
  const keys = ["first", "second", "third"];
  if (keys.every((key) => /^[0-9]+$/.test(String(configured[key] ?? "")))) {
    return keys.map((key) => BigInt(configured[key]));
  }
  return [
    (poolRaw * BigInt(split.first)) / 100n,
    (poolRaw * BigInt(split.second)) / 100n,
    (poolRaw * BigInt(split.third)) / 100n,
  ];
}

async function performWheelDraw(month, trigger = "manual") {
  if (!isValidMonth(month)) throw wheelDrawError("Invalid month. Use YYYY-MM.");

  const cfg = await db.one("SELECT wheel_wallet, prize_split FROM wheel_config LIMIT 1");
  const tokenInfo = cfg?.wheel_wallet ? await mvxTokenBalance(cfg.wheel_wallet, TCL_TOKEN) : null;
  const poolRaw = BigInt(tokenInfo?.balance || "0");
  const split = cfg?.prize_split || { first: 50, second: 30, third: 20 };
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked",
      [`wheel-draw:${month}`]
    );
    if (!lock.rows[0]?.locked) throw wheelDrawError(`A draw for ${month} is already running.`, 409);

    const existing = await client.query(
      "SELECT id FROM wheel_winners WHERE raffle_month=$1 LIMIT 1",
      [month]
    );
    if (existing.rows[0]) throw wheelDrawError(`Winners already drawn for ${month}.`, 409);

    const campaignResult = await client.query(
      `SELECT month, status, closes_at, draw_at, prize_amounts
         FROM wheel_campaigns
        WHERE month=$1
        FOR UPDATE`,
      [month]
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) throw wheelDrawError(`No campaign configured for ${month}.`, 404);
    if (Date.now() < new Date(campaign.closes_at).getTime()) {
      throw wheelDrawError(`Entries for ${month} are still open.`, 409);
    }
    if (Date.now() < new Date(campaign.draw_at).getTime()) {
      throw wheelDrawError(`The scheduled draw time for ${month} has not arrived.`, 409);
    }

    const ticketsResult = await client.query(
      `SELECT id, ticket_number, wallet_address, herotag
         FROM wheel_tickets
        WHERE raffle_month=$1 AND status='valid'
        ORDER BY id ASC`,
      [month]
    );
    const tickets = ticketsResult.rows;
    if (tickets.length < 3) {
      await client.query(
        "UPDATE wheel_campaigns SET status='cancelled', updated_at=NOW() WHERE month=$1",
        [month]
      );
      await client.query(
        "INSERT INTO wheel_audit_logs (action, wallet_address, data) VALUES ($1,NULL,$2)",
        ["draw_cancelled", JSON.stringify({ month, total_tickets: tickets.length, reason: "not_enough_tickets" })]
      );
      await client.query("COMMIT");
      const error = wheelDrawError(`Not enough tickets (${tickets.length}). Need at least 3. Campaign cancelled.`, 409);
      error.transactionCommitted = true;
      throw error;
    }

    const seed = randomBytes(32);
    const ticketSet = tickets.map((ticket) => `${ticket.id}:${ticket.ticket_number}`).join("\n");
    const ticketSetHash = createHash("sha256").update(ticketSet, "utf8").digest("hex");
    const ranked = tickets
      .map((ticket) => ({
        ...ticket,
        score: createHmac("sha256", seed)
          .update(`${month}:${ticket.id}:${ticket.ticket_number}`, "utf8")
          .digest("hex"),
      }))
      .sort((a, b) => a.score.localeCompare(b.score) || Number(a.id) - Number(b.id));
    const chosen = ranked.slice(0, 3);
    const rewards = wheelDrawRewards(campaign, poolRaw, split);
    const proof = {
      version: 1,
      algorithm: "HMAC-SHA256(seed, month:ticket_id:ticket_number), ascending score",
      seed: seed.toString("hex"),
      ticket_set_sha256: ticketSetHash,
      total_tickets: tickets.length,
      drawn_at: new Date().toISOString(),
      trigger,
    };

    for (let i = 0; i < chosen.length; i++) {
      await client.query(
        `INSERT INTO wheel_winners
          (raffle_month, place, ticket_id, ticket_number, wallet_address, herotag,
           reward_tcl, paid_status, draw_proof)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'unpaid',$8)`,
        [
          month, i + 1, chosen[i].id, chosen[i].ticket_number,
          chosen[i].wallet_address, chosen[i].herotag, rewards[i].toString(),
          JSON.stringify({ ...proof, score: chosen[i].score }),
        ]
      );
    }

    await client.query(
      "UPDATE wheel_campaigns SET status='drawn', updated_at=NOW() WHERE month=$1",
      [month]
    );
    await client.query(
      "INSERT INTO wheel_audit_logs (action, wallet_address, data) VALUES ($1,NULL,$2)",
      ["draw_winners", JSON.stringify({
        month,
        total_tickets: tickets.length,
        chosen: chosen.map((ticket) => ticket.ticket_number),
        proof,
      })]
    );
    await client.query("COMMIT");

    return {
      ok: true,
      month,
      proof,
      winners: chosen.map((ticket, index) => ({
        place: index + 1,
        ticket: ticket.ticket_number,
        wallet: ticket.wallet_address,
        herotag: ticket.herotag,
        reward_tcl: formatTcl(rewards[index].toString()),
      })),
    };
  } catch (error) {
    if (!error?.transactionCommitted) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ── Admin routes ──────────────────────────────────────────────────────────────

// POST /wheel/admin/draw
wheel.post("/admin/draw", async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const month = String(req.body?.month || utcMonth()).trim();
    ok(res, await performWheelDraw(month, "manual"));
  } catch (e) {
    fail(res, e?.status ? e.message : "Server error.", e?.status || 500);
    console.error(e);
  }
});

// POST /wheel/admin/mark-paid
wheel.post("/admin/mark-paid", async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const { month, place, tx_hash } = req.body || {};
    if (!month || !place) return fail(res, "month and place required.");
    await db.query(
      `UPDATE wheel_winners
          SET paid_status='paid',
              paid_tx_hash=$1,
              payout_confirmed_at=NOW(),
              payout_error=NULL
        WHERE raffle_month=$2 AND place=$3`,
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

// POST /wheel/admin/upsert-campaign
wheel.post("/admin/upsert-campaign", async (req, res) => {
  if (!adminAuth(req, res)) return;
  try {
    const body = req.body || {};
    const month = String(body.month || "").trim();
    const status = String(body.status || "draft").trim();
    const startsAt = new Date(body.starts_at);
    const closesAt = new Date(body.closes_at);
    const drawAt = new Date(body.draw_at);
    const countries = Array.from(new Set(
      (Array.isArray(body.eligible_countries) ? body.eligible_countries : [])
        .map((value) => String(value).trim().toUpperCase())
        .filter(isValidCountryCode)
    ));
    const rulesHash = String(body.rules_hash || "").trim().toLowerCase();

    if (!isValidMonth(month)) return fail(res, "Invalid month. Use YYYY-MM.");
    if (!["draft", "open", "closed", "drawn", "cancelled"].includes(status)) return fail(res, "Invalid campaign status.");
    if ([startsAt, closesAt, drawAt].some((value) => Number.isNaN(value.getTime()))) return fail(res, "Invalid campaign dates.");
    if (!(startsAt < closesAt) || !(closesAt <= drawAt)) return fail(res, "Campaign dates must satisfy starts_at < closes_at <= draw_at.");
    if (!countries.length) return fail(res, "At least one eligible country is required.");
    if (!/^[0-9a-f]{64}$/.test(rulesHash)) return fail(res, "rules_hash must be a SHA-256 hex digest.");

    const requiredText = [
      "title", "rules_version", "rules_url", "privacy_url",
      "organizer_name", "organizer_address", "organizer_email",
    ];
    for (const field of requiredText) {
      if (!String(body[field] || "").trim()) return fail(res, `${field} is required.`);
    }

    const campaign = await db.one(
      `INSERT INTO wheel_campaigns
        (month, title, status, starts_at, closes_at, draw_at, min_age,
         eligible_countries, rules_version, rules_url, privacy_url, rules_hash,
         organizer_name, organizer_address, organizer_email, prize_amounts,
         prize_arv_ron, automatic_draw, updated_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (month) DO UPDATE SET
         title=EXCLUDED.title,
         status=EXCLUDED.status,
         starts_at=EXCLUDED.starts_at,
         closes_at=EXCLUDED.closes_at,
         draw_at=EXCLUDED.draw_at,
         min_age=EXCLUDED.min_age,
         eligible_countries=EXCLUDED.eligible_countries,
         rules_version=EXCLUDED.rules_version,
         rules_url=EXCLUDED.rules_url,
         privacy_url=EXCLUDED.privacy_url,
         rules_hash=EXCLUDED.rules_hash,
         organizer_name=EXCLUDED.organizer_name,
         organizer_address=EXCLUDED.organizer_address,
         organizer_email=EXCLUDED.organizer_email,
         prize_amounts=EXCLUDED.prize_amounts,
         prize_arv_ron=EXCLUDED.prize_arv_ron,
         automatic_draw=EXCLUDED.automatic_draw,
         updated_at=NOW()
       RETURNING month, title, status, starts_at, closes_at, draw_at, min_age,
                 eligible_countries, rules_version, rules_url, privacy_url, rules_hash,
                 organizer_name, organizer_address, organizer_email, prize_amounts,
                 prize_arv_ron, automatic_draw`,
      [
        month,
        String(body.title).trim(),
        status,
        startsAt.toISOString(),
        closesAt.toISOString(),
        drawAt.toISOString(),
        Math.max(18, Number(body.min_age) || 18),
        countries,
        String(body.rules_version).trim(),
        String(body.rules_url).trim(),
        String(body.privacy_url).trim(),
        rulesHash,
        String(body.organizer_name).trim(),
        String(body.organizer_address).trim(),
        String(body.organizer_email).trim(),
        JSON.stringify(body.prize_amounts || {}),
        JSON.stringify(body.prize_arv_ron || {}),
        body.automatic_draw !== false,
      ]
    );
    ok(res, { ok: true, campaign: publicCampaign(campaign) });
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

async function reconcileWheelPayout(winner) {
  const txHash = winner.paid_tx_hash;
  if (!txHash || !winner.payout_tx) return;
  let transactionPayload = winner.payout_tx;
  if (typeof transactionPayload === "string") {
    try { transactionPayload = JSON.parse(transactionPayload); } catch { transactionPayload = null; }
  }
  if (!transactionPayload) {
    await db.query(
      `UPDATE wheel_winners
          SET paid_status='failed', payout_error=$1, payout_last_checked_at=NOW()
        WHERE id=$2 AND paid_status='submitted'`,
      ["Stored payout transaction is invalid.", winner.id]
    );
    return;
  }

  let networkTransaction = null;
  try {
    networkTransaction = await getWheelPayoutTransaction(txHash);
  } catch (error) {
    await db.query(
      "UPDATE wheel_winners SET payout_error=$1, payout_last_checked_at=NOW() WHERE id=$2",
      [String(error?.message || error).slice(0, 1000), winner.id]
    );
    return;
  }

  const status = String(networkTransaction?.status || "").toLowerCase();
  if (status === "success" || status === "successful") {
    const result = await db.query(
      `UPDATE wheel_winners
          SET paid_status='paid',
              payout_confirmed_at=NOW(),
              payout_last_checked_at=NOW(),
              payout_error=NULL
        WHERE id=$1 AND paid_status='submitted'
        RETURNING raffle_month, place, wallet_address, reward_tcl`,
      [winner.id]
    );
    const paid = result.rows[0];
    if (paid) {
      await db.query(
        "INSERT INTO wheel_audit_logs (action, wallet_address, data) VALUES ($1,$2,$3)",
        ["prize_payout_confirmed", paid.wallet_address, JSON.stringify({
          month: paid.raffle_month,
          place: paid.place,
          reward_tcl: paid.reward_tcl,
          tx_hash: txHash,
        })]
      );
    }
    return;
  }

  if (["fail", "failed", "invalid"].includes(status)) {
    await db.query(
      `UPDATE wheel_winners
          SET paid_status='failed',
              payout_last_checked_at=NOW(),
              payout_error=$1
        WHERE id=$2 AND paid_status='submitted'`,
      [`MultiversX transaction ended with status: ${status}.`, winner.id]
    );
    return;
  }

  if (networkTransaction) {
    await db.query(
      "UPDATE wheel_winners SET payout_last_checked_at=NOW(), payout_error=NULL WHERE id=$1",
      [winner.id]
    );
    return;
  }

  const sender = String(transactionPayload.sender || "");
  const accountInfo = isValidWallet(sender) ? await mvxAccount(sender) : null;
  const transactionNonce = Number(transactionPayload.nonce);
  const networkNonce = Number(accountInfo?.nonce);
  if (Number.isInteger(transactionNonce) && Number.isInteger(networkNonce) && networkNonce > transactionNonce) {
    await db.query(
      `UPDATE wheel_winners
          SET paid_status='failed',
              payout_last_checked_at=NOW(),
              payout_error=$1
        WHERE id=$2 AND paid_status='submitted'`,
      ["Payout transaction was not found and its nonce has already been consumed.", winner.id]
    );
    return;
  }

  try {
    await broadcastWheelPayout(transactionPayload);
    await db.query(
      "UPDATE wheel_winners SET payout_last_checked_at=NOW(), payout_error=NULL WHERE id=$1",
      [winner.id]
    );
  } catch (error) {
    await db.query(
      "UPDATE wheel_winners SET payout_error=$1, payout_last_checked_at=NOW() WHERE id=$2",
      [String(error?.message || error).slice(0, 1000), winner.id]
    );
  }
}

async function runScheduledWheelPayouts() {
  try {
    const pending = await db.all(
      `SELECT id, raffle_month, place, wallet_address, reward_tcl,
              paid_tx_hash, payout_tx, payout_submitted_at
         FROM wheel_winners
        WHERE paid_status='submitted'
        ORDER BY payout_submitted_at ASC
        LIMIT 10`
    );
    for (const winner of pending) {
      await reconcileWheelPayout(winner);
    }
  } catch (error) {
    console.error("Automatic wheel payout reconciliation failed:", error?.message || error);
  }
}

async function runScheduledWheelDraws() {
  try {
    await runScheduledWheelPayouts();
    await db.query(
      `UPDATE wheel_campaigns
          SET status='closed', updated_at=NOW()
        WHERE status='open' AND closes_at <= NOW()`
    );
    const due = await db.all(
      `SELECT month
         FROM wheel_campaigns
        WHERE automatic_draw=true
          AND status IN ('open','closed')
          AND draw_at <= NOW()
        ORDER BY draw_at ASC`
    );
    for (const campaign of due) {
      try {
        const result = await performWheelDraw(campaign.month, "automatic");
        console.log(`Automatic wheel draw completed for ${campaign.month}: ${result.winners.length} winners`);
      } catch (error) {
        if (error?.status !== 409) {
          console.error(`Automatic wheel draw failed for ${campaign.month}:`, error?.message || error);
        }
      }
    }
  } catch (error) {
    console.error("Automatic wheel draw scan failed:", error?.message || error);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  PNL API  —  /pnl/*
// ══════════════════════════════════════════════════════════════════════════════

const BUY_COINS_ROW_PREFIX   = "buycoins_tx:";
const BUY_COINS_NEWEST_TS    = "buycoins_newest_ts";
const BUY_COINS_LAST_SYNC    = "buycoins_last_sync_at";
const BUY_COINS_BACKFILL_DONE = "buycoins_backfill_done";
const TCL_GAME_CONTRACT      = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk";

function rawToDecimal(raw, decimals = 18) {
  const v = typeof raw === "bigint" ? raw : BigInt(String(raw || "0"));
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac  = s.slice(-decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
function cmpBigDesc(a, b) { return a > b ? -1 : a < b ? 1 : 0; }

// GET /pnl/buy-coins — top 100 TCL karma spenders leaderboard
const pnl = express.Router();

pnl.get("/buy-coins", async (req, res) => {
  try {
    const token = TCL_TOKEN;

    // Load stored buy-coins transactions from tcl_sync_state
    const rows = await db.all(
      "SELECT value FROM tcl_sync_state WHERE key LIKE $1 ORDER BY key ASC",
      [BUY_COINS_ROW_PREFIX + "%"]
    );

    const transactions = [];
    for (const row of rows) {
      try {
        const tx = JSON.parse(row.value || "{}");
        if (tx.txHash && String(tx.wallet || "").startsWith("erd1") && Number.isFinite(Number(tx.timestamp))) {
          transactions.push(tx);
        }
      } catch (_) { /* skip malformed */ }
    }

    // Build leaderboard
    const wallets = new Map();
    let totalSpentRaw = 0n, totalKarma = 0n, totalBurntRaw = 0n;
    let totalCashbackRaw = 0n, totalReferralRaw = 0n;
    let processedTx = 0, skipped = 0, latestTs = 0;

    for (const tx of transactions) {
      try {
        const wallet    = String(tx.wallet || "").toLowerCase();
        const spentRaw  = BigInt(tx.tclSpentRaw  || "0");
        const karma     = BigInt(tx.karma        || "0");
        const burntRaw  = BigInt(tx.burntRaw     || "0");
        const cashbRaw  = BigInt(tx.cashbackRaw  || "0");
        const refRaw    = BigInt(tx.referralRaw  || "0");
        const ts        = Number(tx.timestamp)  || 0;
        const hash      = String(tx.txHash || "");
        if (!wallet.startsWith("erd1") || spentRaw <= 0n || karma <= 0n) { skipped++; continue; }

        const cur = wallets.get(wallet) || { wallet, karma:0n, spentRaw:0n, burntRaw:0n, cashbackRaw:0n, referralRaw:0n, purchases:0, latestTimestamp:0, latestTxHash:"" };
        cur.karma        += karma;
        cur.spentRaw     += spentRaw;
        cur.burntRaw     += burntRaw;
        cur.cashbackRaw  += cashbRaw;
        cur.referralRaw  += refRaw;
        cur.purchases    += 1;
        if (ts >= cur.latestTimestamp) { cur.latestTimestamp = ts; cur.latestTxHash = hash; }
        wallets.set(wallet, cur);
        processedTx++;
        totalKarma       += karma;
        totalSpentRaw    += spentRaw;
        totalBurntRaw    += burntRaw;
        totalCashbackRaw += cashbRaw;
        totalReferralRaw += refRaw;
        latestTs = Math.max(latestTs, ts);
      } catch (_) { skipped++; }
    }

    const [stateTs, stateSync, stateDone] = await Promise.all([
      db.one("SELECT value FROM tcl_sync_state WHERE key=$1", [BUY_COINS_NEWEST_TS]),
      db.one("SELECT value FROM tcl_sync_state WHERE key=$1", [BUY_COINS_LAST_SYNC]),
      db.one("SELECT value FROM tcl_sync_state WHERE key=$1", [BUY_COINS_BACKFILL_DONE]),
    ]);

    const leaderboard = Array.from(wallets.values())
      .sort((a, b) => cmpBigDesc(a.spentRaw, b.spentRaw) || b.purchases - a.purchases || b.latestTimestamp - a.latestTimestamp)
      .slice(0, 100)
      .map((e, i) => ({
        rank: i + 1,
        wallet: e.wallet,
        totalKarma: e.karma.toString(),
        tclSpent: rawToDecimal(e.spentRaw),
        burnt: rawToDecimal(e.burntRaw),
        cashback: rawToDecimal(e.cashbackRaw),
        referral: rawToDecimal(e.referralRaw),
        purchases: e.purchases,
        latestTimestamp: e.latestTimestamp,
        latestTxHash: e.latestTxHash,
      }));

    ok(res, {
      ok: true,
      title: "Top 100 TCL Spenders for Karma",
      token,
      function: "buyCoins",
      leaderboard,
      stats: {
        wallets: wallets.size,
        transactions: processedTx,
        totalKarma: totalKarma.toString(),
        totalTclSpent: rawToDecimal(totalSpentRaw),
        totalBurnt: rawToDecimal(totalBurntRaw),
        totalCashback: rawToDecimal(totalCashbackRaw),
        totalReferral: rawToDecimal(totalReferralRaw),
        latestTimestamp: latestTs,
      },
      meta: {
        source: "self-hosted PostgreSQL buyCoins history",
        generatedAt: new Date().toISOString(),
        lastSyncAt: stateSync?.value || null,
        syncIntervalMinutes: 15,
        complete: stateDone?.value === "true",
        scannedRows: transactions.length,
        skippedRows: skipped,
        cached: false,
      },
    });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// GET /pnl/status — returns sync state
pnl.get("/status", async (req, res) => {
  try {
    const rows = await db.all(
      "SELECT key, value FROM tcl_sync_state WHERE key = ANY($1)",
      [[BUY_COINS_LAST_SYNC, BUY_COINS_NEWEST_TS, BUY_COINS_BACKFILL_DONE, "buycoins_backfill_done"]]
    );
    const state = Object.fromEntries(rows.map(r => [r.key, r.value]));
    ok(res, { ok: true, state });
  } catch (e) { fail(res, "Server error.", 500); console.error(e); }
});

// GET /pnl/enrich?wallet= — enrichment stub (cron handles it)
pnl.get("/enrich", async (req, res) => {
  const wallet = String(req.query.wallet || "").trim().toLowerCase();
  if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");
  ok(res, { ok: true, wallet, status: "ready", enriched: true, source: "server" });
});

// GET /pnl/fast?wallet= — DexScreener or MVX PNL per wallet
pnl.get("/fast", async (req, res) => {
  const wallet = String(req.query.wallet || "").trim().toLowerCase();
  if (!isValidWallet(wallet)) return fail(res, "Invalid wallet address.");

  const cacheKey = `pnl:fast:${wallet}`;
  const cached = cacheGet(cacheKey);
  if (cached) return ok(res, { ...cached, meta: { ...cached.meta, cached: true } });

  try {
    const warnings = [];
    let result = null;
    try {
      result = await fetchDexScreenerPnl(wallet);
    } catch (e) {
      warnings.push(`DexScreener unavailable: ${e?.message || "unknown"}`);
    }
    if (!result || !result.totals?.tradeCount) {
      result = await fetchMultiversXFilteredPnl(wallet, warnings);
    }
    cacheSet(cacheKey, result, 10 * 60 * 1000);
    ok(res, result);
  } catch (e) {
    res.status(502).json({ ok: false, source: "pnl", wallet, error: e?.message || "PNL unavailable" });
  }
});

app.use("/pnl", pnl);

// ══════════════════════════════════════════════════════════════════════════════
//  IN-MEMORY TTL CACHE  (replaces Cloudflare KV)
// ══════════════════════════════════════════════════════════════════════════════

const memCache = new Map();
function cacheGet(key) {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memCache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttlMs) {
  memCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ══════════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS (ported from cloudflare-worker)
// ══════════════════════════════════════════════════════════════════════════════

const ANALYTICS_ENDPOINTS = {
  coin:      "https://api.cryptorank.io/v0/coins/the-cursed-land",
  quarterly: "https://api.cryptorank.io/v0/coins/the-cursed-land/quarterly-history",
  monthly:   "https://api.cryptorank.io/v0/coins/the-cursed-land/monthly-history"
};

const VOLUME_CONFIG = {
  listingDate:            "2024-06-13T00:00:00Z",
  pairAddress:            "erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff",
  baseTokenAddress:       "TCL-fe459d",
  quoteTokenAddress:      "USDC-c76f1f",
  dexUrl:                 "https://api.dexscreener.com/latest/dex/pairs/multiversx/erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff",
  transferUrlBase:        "https://api.multiversx.com/accounts/erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff/transfers",
  transferPageSize:       2000,
  transferMaxPages:       24,
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
  buySummary:  { label: "Total", cells: [12769.57, 13731.55, 16938.63, 15331.59, 14386.82, 22368.5, 15494.47, 9290.3, 18823.35, 23046.71, 11836.11, 11990.28] },
  sellSummary: { label: "Total", cells: [15758.26, 11925.03, 17954.66, 14245.08, 15765.72, 25303.5, 18633.53, 10873.7, 15594.65, 25768.29, 11420.89, 11850.72] },
  totalSummary:{ label: "Total", cells: [28527.84, 25656.58, 34893.29, 29576.67, 30152.53, 47672, 34128, 20164, 34418, 48815, 23257, 23841] },
  totalVolume: 381101.91, buyVolume: 186007.88, sellVolume: 195094.03,
  buyTrades: 4479, sellTrades: 6264, totalTrades: 10743,
  buyDominancePct: 48.81, sellDominancePct: 51.19,
  coveredMonths: 24, averageMonthlyVolume: 15879.25,
  peakBuyMonth:   { year: 2025, monthIndex: 2, value: 14356.93 },
  peakSellMonth:  { year: 2025, monthIndex: 4, value: 15569.59 },
  peakTotalMonth: { year: 2025, monthIndex: 4, value: 29667 },
  totalTclAmount: 171635556.0465,
  largestTclTrade: { hash: "3de764609b2a217a5a95f49067c3a368cea18377c438c824051a63d6f4abb80c", timestamp: 1760886732, side: "buy", volumeUsd: 6660, tclAmount: 5642936.6426, description: "Transfer" },
  oldestTrade:  { hash: "6d96b9a735ea91749f56673dc408f0874a9a477d5e5db63e1a9c0f429415d4a1", timestamp: 1718301642, side: "buy", volumeUsd: 165, tclAmount: 27049.6602, description: "Transfer" },
  latestTrade:  { hash: "9c2067bfcd23208d68c412985f1078fa71b17b029ec94c1177f8addb2ebf0df6", timestamp: 1778140890, side: "sell", volumeUsd: 0.13, tclAmount: 157.5, description: "Swap 106.5645 TCL for a minimum of 0.000001 USDC" },
  fetchMeta: { reachedListingStart: false, hitPageLimit: false, oldestTimestamp: 1718299206, exhaustedHistory: true, snapshotAt: 1778143726, sourceLabel: "server seed" }
};

const PNL_DEXSCREENER_CONFIG = {
  chainId: "multiversx", ammId: "xexchange",
  pairAddress:       "erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff",
  quoteTokenAddress: "USDC-c76f1f",
  logsBaseUrl:       "https://io.dexscreener.com/dex/log/amm/v4",
  pagePauseMs: 300, maxPages: 80, maxAttempts: 3
};
const PNL_MVX_CONFIG = {
  apiBase: "https://api.multiversx.com",
  pageSize: 50, tokenMaxPages: 10, pairMaxPages: 5, pagePauseMs: 80, maxAttempts: 3
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function numberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function roundNumber(v, d) { if (!Number.isFinite(v)) return null; const f = 10 ** d; return Math.round(v * f) / f; }
function getPercentChange(open, close) {
  const o = numberOrNull(open), c = numberOrNull(close);
  if (o === null || c === null || o === 0) return null;
  return roundNumber(((c / o) - 1) * 100, 8);
}
function getAverage(vals) { const s = vals.filter(Number.isFinite); if (!s.length) return null; return roundNumber(s.reduce((a,b)=>a+b,0)/s.length, 2); }
function getMedian(vals) {
  const s = vals.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!s.length) return null;
  const m = Math.floor(s.length/2);
  return roundNumber(s.length%2===1 ? s[m] : (s[m-1]+s[m])/2, 2);
}
function newMatrixRow(label, cells) { return { label, cells }; }
function cloneJson(v) { return JSON.parse(JSON.stringify(v)); }

function decimalStringToNumber(value, decimals) {
  if (typeof value !== "string" || !value.length) return NaN;
  const neg = value.startsWith("-");
  const digits = neg ? value.slice(1) : value;
  if (!/^\d+$/.test(digits)) return NaN;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac  = padded.slice(padded.length - decimals);
  const fmt   = decimals > 0 ? `${whole}.${frac}` : whole;
  const n = Number(neg ? `-${fmt}` : fmt);
  return Number.isFinite(n) ? n : NaN;
}

function resolveVolumeTokenDecimals(token) {
  return token === VOLUME_CONFIG.quoteTokenAddress ? 6 : 18;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

async function fetchAnalyticsJson(url, maxAttempts = 4) {
  let lastErr;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "TCLExplorerAnalyticsSync/1.0" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const p = await r.json();
      if (!p) throw new Error("Empty response");
      return p;
    } catch (e) { lastErr = e; if (i < maxAttempts) await sleep(1500 * i); }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr?.message}`);
}

async function buildAnalyticsSnapshot() {
  const [coinPay, qPay, mPay] = await Promise.all([
    fetchAnalyticsJson(ANALYTICS_ENDPOINTS.coin),
    fetchAnalyticsJson(ANALYTICS_ENDPOINTS.quarterly),
    fetchAnalyticsJson(ANALYTICS_ENDPOINTS.monthly)
  ]);
  const coin = coinPay?.data || {};
  const quarterlyData = Array.isArray(qPay?.data) ? qPay.data : [];
  const monthlyData = mPay?.data || {};
  const currentPrice = numberOrNull(coin?.price?.USD);

  const performance = [
    { label: "1W", key: "7D" }, { label: "1M", key: "30D" },
    { label: "3M", key: "3M" }, { label: "6M", key: "6M" },
    { label: "YTD", key: "YTD" }, { label: "1Y", key: "1Y" }
  ].map(m => {
    const startPrice = numberOrNull(coin?.histPrices?.[m.key]?.USD);
    const high = numberOrNull(coin?.histData?.high?.[m.key]?.USD);
    const low  = numberOrNull(coin?.histData?.low?.[m.key]?.USD);
    const change = currentPrice !== null && startPrice !== null && startPrice !== 0 ? roundNumber(currentPrice - startPrice, 12) : null;
    return { label: m.label, key: m.key, startPrice, currentPrice, change, changePct: getPercentChange(startPrice, currentPrice), high, low };
  });

  const quarterColumns = ["Q1","Q2","Q3","Q4"];
  const sortedQ = [...quarterlyData].sort((a,b) => Number(b?.year) - Number(a?.year));
  const quarterlyReturnsRows  = sortedQ.map(e => newMatrixRow(String(e?.year||""), [1,2,3,4].map(qi => { const q = e?.[`q${qi}`]; return q ? getPercentChange(numberOrNull(q.openUSD), numberOrNull(q.closeUSD)) : null; })));
  const quarterlyClosingRows  = sortedQ.map(e => newMatrixRow(String(e?.year||""), [1,2,3,4].map(qi => { const q = e?.[`q${qi}`]; return (q && q.isFull) ? numberOrNull(q.closeUSD) : null; })));
  const monthColumns = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthValuesByIndex = Array.from({ length: 13 }, () => []);
  const monthlyRows = Object.keys(monthlyData).sort((a,b) => Number(b)-Number(a)).map(year => {
    const ym = monthlyData?.[year]?.months || {};
    const cells = monthColumns.map((_m, idx) => {
      const mi = idx + 1;
      const me = ym?.[mi] || ym?.[String(mi)];
      if (!me) return null;
      const cp = getPercentChange(numberOrNull(me.openUSD), numberOrNull(me.closeUSD));
      if (cp !== null) monthValuesByIndex[mi].push(cp);
      return cp;
    });
    return newMatrixRow(String(year), cells);
  });
  const averageCells = monthColumns.map((_,i) => getAverage(monthValuesByIndex[i+1]));
  const medianCells  = monthColumns.map((_,i) => getMedian(monthValuesByIndex[i+1]));

  return {
    meta: { updatedAt: new Date().toISOString(), source: "CryptoRank", endpoints: ANALYTICS_ENDPOINTS },
    coin: { name: String(coin?.name||""), symbol: String(coin?.symbol||""), key: String(coin?.key||""), image: { x60: String(coin?.image?.x60||""), x150: String(coin?.image?.x150||"") } },
    market: { currentPriceUsd: currentPrice, marketCapUsd: numberOrNull(coin?.marketCap), volume24hUsd: numberOrNull(coin?.volume24h), athPriceUsd: numberOrNull(coin?.athPrice?.USD), atlPriceUsd: numberOrNull(coin?.atlPrice?.USD), listingDate: String(coin?.listingDate||""), historyStartDay: String(coin?.historyStartDay||""), historyEndDay: String(coin?.historyEndDay||"") },
    performance,
    quarterlyReturns: { columns: quarterColumns, rows: quarterlyReturnsRows },
    quarterlyClosing: { columns: quarterColumns, rows: quarterlyClosingRows },
    monthlyReturns: { columns: monthColumns, rows: monthlyRows, summary: [newMatrixRow("Average", averageCells), newMatrixRow("Median", medianCells)] }
  };
}

// ── Volume helpers ─────────────────────────────────────────────────────────────

function isVolumeCoveredMonth(year, monthIndex, startDate, endDate) {
  const sy = startDate.getUTCFullYear(), sm = startDate.getUTCMonth();
  const ey = endDate.getUTCFullYear(),   em = endDate.getUTCMonth();
  if (year < sy || year > ey) return false;
  if (year === sy && monthIndex < sm) return false;
  if (year === ey && monthIndex > em) return false;
  return true;
}
function createVolumeCoverageRows(startDate, endDate) {
  const rows = [];
  for (let y = endDate.getUTCFullYear(); y >= startDate.getUTCFullYear(); y--) {
    rows.push({ label: String(y), cells: Array.from({length:12}, (_,mi) => isVolumeCoveredMonth(y,mi,startDate,endDate) ? 0 : null) });
  }
  return rows;
}
function buildVolumeSummaryRow(rows, label="Total") {
  const cells = Array.from({length:12}, (_,mi) => {
    let hasCov = false, sum = 0;
    for (const row of rows) { const c = row.cells[mi]; if (c != null) { hasCov = true; sum += c; } }
    return hasCov ? sum : null;
  });
  return { label, cells };
}
function countVolumeCoveredMonths(rows) { let n=0; for (const r of rows) for (const c of r.cells) if (c!=null) n++; return n; }
function findVolumePeakMonth(rows) {
  let peak = null;
  for (const r of rows) { const y=Number(r.label); for (let mi=0;mi<r.cells.length;mi++) { const v=r.cells[mi]; if (v==null) continue; if (!peak||v>peak.value) peak={year:y,monthIndex:mi,value:v}; } }
  return peak;
}
function sumVolumeMatrixValues(rows) { let t=0; for (const r of rows) for (const c of r.cells) if (typeof c==="number"&&!isNaN(c)) t+=c; return t; }

function rebuildVolumeAggregatedDerivedState(agg) {
  agg.totalVolume  = sumVolumeMatrixValues(agg.totalRows);
  agg.buyVolume    = sumVolumeMatrixValues(agg.buyRows);
  agg.sellVolume   = sumVolumeMatrixValues(agg.sellRows);
  agg.coveredMonths = countVolumeCoveredMonths(agg.totalRows);
  agg.averageMonthlyVolume = agg.coveredMonths > 0 ? agg.totalVolume / agg.coveredMonths : 0;
  agg.buySummary   = buildVolumeSummaryRow(agg.buyRows,   "Total");
  agg.sellSummary  = buildVolumeSummaryRow(agg.sellRows,  "Total");
  agg.totalSummary = buildVolumeSummaryRow(agg.totalRows, "Total");
  agg.peakBuyMonth   = findVolumePeakMonth(agg.buyRows);
  agg.peakSellMonth  = findVolumePeakMonth(agg.sellRows);
  agg.peakTotalMonth = findVolumePeakMonth(agg.totalRows);
  agg.buyDominancePct  = agg.totalVolume > 0 ? (agg.buyVolume  / agg.totalVolume) * 100 : 0;
  agg.sellDominancePct = agg.totalVolume > 0 ? (agg.sellVolume / agg.totalVolume) * 100 : 0;
  agg.totalTrades = (Number(agg.buyTrades)||0) + (Number(agg.sellTrades)||0);
  return agg;
}

function expandVolumeRowsToEndDate(rows, endDate) {
  const nd = endDate instanceof Date ? endDate : new Date();
  const fresh = createVolumeCoverageRows(new Date(VOLUME_CONFIG.listingDate), nd);
  const existing = new Map((Array.isArray(rows)?rows:[]).map(r=>[String(r.label), Array.isArray(r.cells)?r.cells:[]]));
  for (const fr of fresh) {
    const ec = existing.get(String(fr.label));
    if (!ec) continue;
    for (let mi=0;mi<fr.cells.length;mi++) { if (ec[mi]!==undefined) fr.cells[mi]=ec[mi]; }
  }
  return fresh;
}

function normalizeVolumeAggregatedSnapshot(agg, endDate=new Date()) {
  const c = cloneJson(agg);
  c.buyRows   = expandVolumeRowsToEndDate(c.buyRows,   endDate);
  c.sellRows  = expandVolumeRowsToEndDate(c.sellRows,  endDate);
  c.totalRows = expandVolumeRowsToEndDate(c.totalRows, endDate);
  return rebuildVolumeAggregatedDerivedState(c);
}

function hasValidVolumeAggregatedShape(v) {
  return Boolean(v && Array.isArray(v.buyRows) && Array.isArray(v.sellRows) && Array.isArray(v.totalRows) && v.latestTrade && Number.isFinite(Number(v.latestTrade.timestamp)));
}

function normalizeVolumeTradeTransfer(transfer, pair) {
  if (!transfer?.token || !transfer?.value) return null;
  const decimals = Number(transfer.decimals ?? resolveVolumeTokenDecimals(transfer.token));
  const amount = decimalStringToNumber(transfer.value, decimals);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { token: transfer.token, amount };
}

function parseVolumeTrades(transfers, pair) {
  const tradeList = [];
  const groupedSwaps = new Map();
  for (const entry of Array.isArray(transfers)?transfers:[]) {
    if (entry?.status !== "success") continue;
    const tl = entry?.action?.arguments?.transfers;
    if (!Array.isArray(tl) || !tl.length) continue;
    const pt = normalizeVolumeTradeTransfer(tl[0], pair);
    if (!pt) continue;
    const ts = Number(entry.timestamp);
    if (!Number.isFinite(ts)) continue;
    const gh = String(entry.originalTxHash || entry.txHash || "");
    if (!gh) continue;
    let gs = groupedSwaps.get(gh);
    if (!gs) { gs = { hash:gh, timestamp:ts, inputToken:null, inputAmount:0, outputToken:null, outputAmount:0, description:"", invalid:false }; groupedSwaps.set(gh, gs); }
    else if (ts < gs.timestamp) gs.timestamp = ts;
    if (!gs.description && entry?.action?.description) gs.description = entry.action.description;
    if (entry.receiver === pair?.pairAddress && entry.function === "swapTokensFixedInput") {
      if (gs.inputToken && gs.inputToken !== pt.token) { gs.invalid=true; continue; }
      gs.inputToken = pt.token; gs.inputAmount += pt.amount; continue;
    }
    const isPairOutput = entry.sender === pair?.pairAddress && entry.function !== "depositSwapFees" && (pt.token === pair?.baseToken?.address || pt.token === pair?.quoteToken?.address);
    if (!isPairOutput) continue;
    if (gs.outputToken && gs.outputToken !== pt.token) { gs.invalid=true; continue; }
    gs.outputToken = pt.token; gs.outputAmount += pt.amount;
  }
  for (const gs of groupedSwaps.values()) {
    if (gs.invalid || !gs.inputAmount || !gs.outputAmount || !gs.inputToken || !gs.outputToken) continue;
    let tclAmount=0, usdcAmount=0, side=null;
    if (gs.inputToken===pair.quoteToken.address && gs.outputToken===pair.baseToken.address) { usdcAmount=gs.inputAmount; tclAmount=gs.outputAmount; side="buy"; }
    else if (gs.inputToken===pair.baseToken.address && gs.outputToken===pair.quoteToken.address) { tclAmount=gs.inputAmount; usdcAmount=gs.outputAmount; side="sell"; }
    else continue;
    const price = usdcAmount / tclAmount;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(usdcAmount) || usdcAmount <= 0) continue;
    tradeList.push({ hash:gs.hash, timestamp:gs.timestamp, side, price, volumeUsd:usdcAmount, tclAmount, description:gs.description });
  }
  return tradeList.sort((a,b)=>a.timestamp-b.timestamp);
}

function aggregateVolumeTrades(trades, fetchMeta) {
  const startDate = new Date(VOLUME_CONFIG.listingDate);
  const endDate = new Date();
  const buyRows   = createVolumeCoverageRows(startDate, endDate);
  const sellRows  = createVolumeCoverageRows(startDate, endDate);
  const totalRows = createVolumeCoverageRows(startDate, endDate);
  const buyMap   = new Map(buyRows.map(r=>[r.label,r]));
  const sellMap  = new Map(sellRows.map(r=>[r.label,r]));
  const totalMap = new Map(totalRows.map(r=>[r.label,r]));
  let buyTrades=0, sellTrades=0, totalTclAmount=0, oldestTrade=null, latestTrade=null, largestTclTrade=null;
  for (const trade of Array.isArray(trades)?trades:[]) {
    if (!Number.isFinite(trade.timestamp)||!Number.isFinite(trade.volumeUsd)||trade.volumeUsd<0) continue;
    const d = new Date(trade.timestamp*1000);
    const yk = String(d.getUTCFullYear()), mi = d.getUTCMonth();
    const tr = totalMap.get(yk), br = buyMap.get(yk), sr = sellMap.get(yk);
    if (tr && tr.cells[mi]!=null) tr.cells[mi] += trade.volumeUsd;
    if (trade.side==="buy") { buyTrades++; if (br && br.cells[mi]!=null) br.cells[mi] += trade.volumeUsd; }
    else if (trade.side==="sell") { sellTrades++; if (sr && sr.cells[mi]!=null) sr.cells[mi] += trade.volumeUsd; }
    if (Number.isFinite(trade.tclAmount) && trade.tclAmount>0) {
      totalTclAmount += trade.tclAmount;
      if (!largestTclTrade || trade.tclAmount > largestTclTrade.tclAmount) largestTclTrade = trade;
    }
    if (!oldestTrade || trade.timestamp < oldestTrade.timestamp) oldestTrade = trade;
    if (!latestTrade || trade.timestamp > latestTrade.timestamp) latestTrade = trade;
  }
  return rebuildVolumeAggregatedDerivedState({ version:2, buyRows, sellRows, totalRows, buyTrades, sellTrades, totalTclAmount, largestTclTrade, oldestTrade, latestTrade, fetchMeta });
}

function mergeVolumeTradesIntoAggregated(baseAgg, trades, fetchMeta) {
  const agg = normalizeVolumeAggregatedSnapshot(baseAgg, new Date());
  const buyMap   = new Map(agg.buyRows.map(r=>[r.label,r]));
  const sellMap  = new Map(agg.sellRows.map(r=>[r.label,r]));
  const totalMap = new Map(agg.totalRows.map(r=>[r.label,r]));
  agg.buyTrades    = Number(agg.buyTrades)||0;
  agg.sellTrades   = Number(agg.sellTrades)||0;
  agg.totalTclAmount = Number(agg.totalTclAmount)||0;
  for (const trade of Array.isArray(trades)?trades:[]) {
    if (!Number.isFinite(trade.timestamp)||!Number.isFinite(trade.volumeUsd)||trade.volumeUsd<0) continue;
    const d = new Date(trade.timestamp*1000);
    const yk = String(d.getUTCFullYear()), mi = d.getUTCMonth();
    const tr = totalMap.get(yk), br = buyMap.get(yk), sr = sellMap.get(yk);
    if (tr) tr.cells[mi] = (Number(tr.cells[mi])||0) + trade.volumeUsd;
    if (trade.side==="buy") { agg.buyTrades++; if (br) br.cells[mi]=(Number(br.cells[mi])||0)+trade.volumeUsd; }
    else if (trade.side==="sell") { agg.sellTrades++; if (sr) sr.cells[mi]=(Number(sr.cells[mi])||0)+trade.volumeUsd; }
    if (Number.isFinite(trade.tclAmount) && trade.tclAmount>0) {
      agg.totalTclAmount += trade.tclAmount;
      if (!agg.largestTclTrade || trade.tclAmount > agg.largestTclTrade.tclAmount) agg.largestTclTrade = cloneJson(trade);
    }
    if (!agg.oldestTrade || trade.timestamp < agg.oldestTrade.timestamp) agg.oldestTrade = cloneJson(trade);
    if (!agg.latestTrade || trade.timestamp > agg.latestTrade.timestamp) agg.latestTrade = cloneJson(trade);
  }
  agg.fetchMeta = { ...(agg.fetchMeta||{}), ...(fetchMeta||{}) };
  return rebuildVolumeAggregatedDerivedState(agg);
}

async function fetchVolumeDexPair() {
  const p = await fetchAnalyticsJson(VOLUME_CONFIG.dexUrl, 3);
  return p?.pair || (Array.isArray(p?.pairs) ? p.pairs[0] : null);
}

async function fetchVolumeTransferHistory() {
  const transfers = [];
  const listingTs = Math.floor(new Date(VOLUME_CONFIG.listingDate).getTime()/1000);
  let oldestTs=null, reachedListingStart=false, hitPageLimit=false, exhaustedHistory=false, beforeCursor=null;
  for (let pi=0; pi<VOLUME_CONFIG.transferMaxPages; pi++) {
    const params = new URLSearchParams({ size: String(VOLUME_CONFIG.transferPageSize), status:"success", order:"desc" });
    if (beforeCursor!=null) params.set("before", String(beforeCursor));
    const page = await fetchAnalyticsJson(`${VOLUME_CONFIG.transferUrlBase}?${params}`, 3);
    if (!Array.isArray(page)||!page.length) { exhaustedHistory=true; break; }
    transfers.push(...page);
    const pts = page.map(i=>Number(i?.timestamp)).filter(Number.isFinite);
    if (pts.length) oldestTs = oldestTs==null ? Math.min(...pts) : Math.min(oldestTs,...pts);
    if (oldestTs!=null && oldestTs<=listingTs) { reachedListingStart=true; break; }
    if (page.length < VOLUME_CONFIG.transferPageSize) { exhaustedHistory=true; break; }
    beforeCursor = oldestTs!=null ? oldestTs-1 : null;
    if (!beforeCursor || beforeCursor<=0) { exhaustedHistory=true; break; }
    if (pi===VOLUME_CONFIG.transferMaxPages-1) hitPageLimit=true;
  }
  return { transfers, reachedListingStart, hitPageLimit, oldestTimestamp:oldestTs, exhaustedHistory };
}

async function fetchVolumeRecentTransferHistory(afterTimestamp) {
  if (!Number.isFinite(afterTimestamp)) return { transfers:[], hitPageLimit:false, oldestTimestamp:null, exhaustedHistory:true };
  const transfers = [];
  let newestTs=null, hitPageLimit=false, exhaustedHistory=false, afterCursor=Math.floor(afterTimestamp)+1;
  for (let pi=0; pi<VOLUME_CONFIG.recentTransferMaxPages; pi++) {
    const params = new URLSearchParams({ size:String(VOLUME_CONFIG.recentTransferPageSize), status:"success", order:"asc", after:String(afterCursor) });
    const page = await fetchAnalyticsJson(`${VOLUME_CONFIG.transferUrlBase}?${params}`, 3);
    if (!Array.isArray(page)||!page.length) { exhaustedHistory=true; break; }
    transfers.push(...page);
    const pts = page.map(i=>Number(i?.timestamp)).filter(Number.isFinite);
    if (pts.length) newestTs = newestTs==null ? Math.max(...pts) : Math.max(newestTs,...pts);
    if (page.length < VOLUME_CONFIG.recentTransferPageSize) { exhaustedHistory=true; break; }
    afterCursor = newestTs!=null ? newestTs+1 : afterCursor+1;
    if (!Number.isFinite(afterCursor)||afterCursor<=0) { exhaustedHistory=true; break; }
    if (pi===VOLUME_CONFIG.recentTransferMaxPages-1) hitPageLimit=true;
  }
  return { transfers, hitPageLimit, oldestTimestamp: transfers.length ? (Number(transfers[0]?.timestamp)||null) : null, exhaustedHistory };
}

async function buildVolumeSnapshot(currentSnapshot=null) {
  const nowSec = Math.floor(Date.now()/1000);
  const warnings = [];
  let pair = currentSnapshot?.pair || null;
  try { pair = await fetchVolumeDexPair(); } catch(e) { warnings.push(`DexScreener: ${e?.message}`); }
  const baseAgg = hasValidVolumeAggregatedShape(currentSnapshot?.aggregated) ? currentSnapshot.aggregated : VOLUME_SEED_SNAPSHOT;
  const normalizedBase = normalizeVolumeAggregatedSnapshot(baseAgg, new Date());
  const latestTs = Number(normalizedBase?.latestTrade?.timestamp);
  let recentHistory = { transfers:[], hitPageLimit:false, oldestTimestamp:null, exhaustedHistory:true };
  try { recentHistory = await fetchVolumeRecentTransferHistory(latestTs); } catch(e) { warnings.push(`MVX transfers: ${e?.message}`); }
  const pairRef = {
    pairAddress:  pair?.pairAddress  || VOLUME_CONFIG.pairAddress,
    baseToken:  { address: pair?.baseToken?.address  || VOLUME_CONFIG.baseTokenAddress },
    quoteToken: { address: pair?.quoteToken?.address || VOLUME_CONFIG.quoteTokenAddress }
  };
  const trades = parseVolumeTrades(recentHistory.transfers, pairRef);
  const sourceLabel = trades.length ? "server cache + live" : "server cache";
  const fetchMeta = { hitPageLimit:recentHistory.hitPageLimit, oldestTimestamp:recentHistory.oldestTimestamp, exhaustedHistory:recentHistory.exhaustedHistory, recentTransfers:recentHistory.transfers.length, parsedTrades:trades.length, snapshotAt:nowSec, sourceLabel };
  const aggregated = trades.length ? mergeVolumeTradesIntoAggregated(normalizedBase, trades, fetchMeta) : rebuildVolumeAggregatedDerivedState({ ...normalizedBase, fetchMeta:{...(normalizedBase.fetchMeta||{}),...fetchMeta} });
  return { ok:true, meta:{ updatedAt:new Date().toISOString(), source:"Server API", endpoints:{ dex:VOLUME_CONFIG.dexUrl, transfers:VOLUME_CONFIG.transferUrlBase }, warnings }, pair, aggregated };
}

// ── Technicals helpers ─────────────────────────────────────────────────────────

function normalizeTechnicalTrade(t) {
  return { hash:String(t.hash), timestamp:Number(t.timestamp), price:Number(t.price), volumeUsd:Number(t.volumeUsd), tclAmount:Number(t.tclAmount), side:t.side, description:typeof t.description==="string"?t.description:"" };
}
function isValidTechnicalTrade(t) {
  return Boolean(t && typeof t.hash==="string" && t.hash.length && Number.isFinite(Number(t.timestamp)) && Number.isFinite(Number(t.price)) && Number(t.price)>0 && Number.isFinite(Number(t.volumeUsd)) && Number(t.volumeUsd)>0 && Number.isFinite(Number(t.tclAmount)) && Number(t.tclAmount)>0 && (t.side==="buy"||t.side==="sell"));
}
function normalizeTechnicalsTrades(trades) {
  return (Array.isArray(trades)?trades:[]).filter(isValidTechnicalTrade).map(normalizeTechnicalTrade).sort((a,b)=>a.timestamp-b.timestamp);
}
function mergeTechnicalTradeLists(existing, incoming) {
  const m = new Map();
  for (const t of existing||[]) if (isValidTechnicalTrade(t)) m.set(t.hash, normalizeTechnicalTrade(t));
  for (const t of incoming||[]) if (isValidTechnicalTrade(t)) m.set(t.hash, normalizeTechnicalTrade(t));
  return Array.from(m.values()).sort((a,b)=>a.timestamp-b.timestamp);
}
function createTechnicalsSnapshot({ pair, trades, warnings, fetchMeta }) {
  const nt = normalizeTechnicalsTrades(trades);
  const latestTradeTimestamp = Number(nt[nt.length-1]?.timestamp)||0;
  return { ok:true, version:1, meta:{ updatedAt:new Date().toISOString(), source:"Server API", endpoints:{ dex:VOLUME_CONFIG.dexUrl, transfers:VOLUME_CONFIG.transferUrlBase }, warnings:Array.isArray(warnings)?warnings:[], fetchMeta }, pair, trades:nt, latestTradeTimestamp };
}

async function buildTechnicalsSnapshot(currentSnapshot=null) {
  const warnings = [];
  const nowSec = Math.floor(Date.now()/1000);
  let pair = currentSnapshot?.pair || null;
  try { pair = await fetchVolumeDexPair(); } catch(e) { warnings.push(`DexScreener: ${e?.message}`); }
  const pairRef = { pairAddress:pair?.pairAddress||currentSnapshot?.pair?.pairAddress||VOLUME_CONFIG.pairAddress, baseToken:{address:pair?.baseToken?.address||currentSnapshot?.pair?.baseToken?.address||VOLUME_CONFIG.baseTokenAddress}, quoteToken:{address:pair?.quoteToken?.address||currentSnapshot?.pair?.quoteToken?.address||VOLUME_CONFIG.quoteTokenAddress} };
  const baseTrades = normalizeTechnicalsTrades(currentSnapshot?.trades);
  const latestTs = Number(currentSnapshot?.latestTradeTimestamp ?? baseTrades[baseTrades.length-1]?.timestamp);

  if (!baseTrades.length) {
    try {
      const fh = await fetchVolumeTransferHistory();
      const ft = normalizeTechnicalsTrades(parseVolumeTrades(fh.transfers, pairRef));
      if (!ft.length) throw new Error("No trades from full history");
      return createTechnicalsSnapshot({ pair, trades:ft, warnings, fetchMeta:{ reachedListingStart:fh.reachedListingStart, hitPageLimit:fh.hitPageLimit, oldestTimestamp:fh.oldestTimestamp, exhaustedHistory:fh.exhaustedHistory!==false, recentTransfers:fh.transfers.length, parsedTrades:ft.length, snapshotAt:nowSec, sourceLabel:"server full" } });
    } catch(e) { warnings.push(`Full MVX refresh: ${e?.message}`); if (!baseTrades.length) throw e; }
  }

  let rh = { transfers:[], hitPageLimit:false, oldestTimestamp:null, exhaustedHistory:true };
  try { rh = await fetchVolumeRecentTransferHistory(latestTs); } catch(e) { warnings.push(`MVX transfers: ${e?.message}`); }
  const liveTrades = normalizeTechnicalsTrades(parseVolumeTrades(rh.transfers, pairRef));
  const trades = mergeTechnicalTradeLists(baseTrades, liveTrades);
  if (!trades.length) throw new Error("No cached swap trades available for technicals.");
  return createTechnicalsSnapshot({ pair, trades, warnings, fetchMeta:{ hitPageLimit:rh.hitPageLimit, oldestTimestamp:rh.oldestTimestamp, exhaustedHistory:rh.exhaustedHistory!==false, recentTransfers:Array.isArray(rh.transfers)?rh.transfers.length:0, parsedTrades:liveTrades.length, snapshotAt:nowSec, sourceLabel:liveTrades.length?"server cache + live":"server cache" } });
}

// ── PNL fast helpers ───────────────────────────────────────────────────────────

function buildDexScreenerPnlUrl(wallet, beforeBlockNumber=null) {
  const cfg = PNL_DEXSCREENER_CONFIG;
  const url = new URL(`${cfg.logsBaseUrl}/${cfg.ammId}/all/${cfg.chainId}/${encodeURIComponent(cfg.pairAddress)}`);
  url.searchParams.set("q", cfg.quoteTokenAddress);
  url.searchParams.set("m", wallet);
  url.searchParams.set("c", "1");
  if (Number.isFinite(beforeBlockNumber) && beforeBlockNumber > 0) url.searchParams.set("bbn", String(Math.floor(beforeBlockNumber)));
  return url.toString();
}

async function fetchDexScreenerJson(url) {
  let lastErr;
  for (let i=1; i<=PNL_DEXSCREENER_CONFIG.maxAttempts; i++) {
    try {
      const r = await fetch(url, { headers:{ Accept:"application/json", Referer:"https://dexscreener.com/" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) { const t=await r.text().catch(()=>""); throw new Error(`DexScreener HTTP ${r.status}${t?`: ${t.slice(0,80)}`:""}`); }
      const p = await r.json();
      if (!p||!Array.isArray(p.logs)) throw new Error("DexScreener response did not contain logs");
      return p;
    } catch(e) { lastErr=e; if (i<PNL_DEXSCREENER_CONFIG.maxAttempts) await sleep(800*i); }
  }
  throw new Error(lastErr?.message || "DexScreener logs unavailable");
}

function normalizeDexTimestamp(v) { const t=Number(v); if (!Number.isFinite(t)||t<=0) return null; return t>10000000000 ? Math.floor(t/1000) : Math.floor(t); }
function normalizeDexNumber(v) { const n=Number(String(v??"").replace(/,/g,"")); return Number.isFinite(n)?n:0; }

function parseDexScreenerPnlTrade(log) {
  if (!log || log.logType!=="swap") return null;
  if (log.txnType!=="buy" && log.txnType!=="sell") return null;
  const tclAmount=normalizeDexNumber(log.amount0), quoteAmount=normalizeDexNumber(log.amount1);
  const volumeUsd=normalizeDexNumber(log.volumeUsd)||quoteAmount;
  const timestamp=normalizeDexTimestamp(log.blockTimestamp), blockNumber=Number(log.blockNumber), logIndex=Number(log.logIndex), hash=String(log.txnHash||"");
  if (!hash||!timestamp||!Number.isFinite(blockNumber)||blockNumber<=0) return null;
  if (!Number.isFinite(tclAmount)||tclAmount<=0||!Number.isFinite(volumeUsd)||volumeUsd<=0) return null;
  return { hash, key:`${hash}:${Number.isFinite(logIndex)?logIndex:0}`, timestamp, blockNumber, side:log.txnType, price:normalizeDexNumber(log.priceUsd)||(volumeUsd/tclAmount), volumeUsd, tclAmount, description:"DexScreener TCL/USDC swap" };
}

function aggregatePnlDexTrades(trades) {
  return trades.reduce((t, tr) => {
    if (tr.side==="buy") { t.buyCount++; t.buyTcl+=tr.tclAmount; t.buyUsd+=tr.volumeUsd; }
    else if (tr.side==="sell") { t.sellCount++; t.sellTcl+=tr.tclAmount; t.sellUsd+=tr.volumeUsd; }
    t.tradeCount++;
    return t;
  }, { tradeCount:0, buyCount:0, sellCount:0, buyTcl:0, sellTcl:0, buyUsd:0, sellUsd:0 });
}

async function fetchDexScreenerPnl(wallet) {
  const tradeMap = new Map();
  let beforeBN=null, oldestBN=null, newestBN=null, oldestTs=null, pageCount=0, checkedLogs=0, exhaustedHistory=false, hitPageLimit=false;
  for (let pi=0; pi<PNL_DEXSCREENER_CONFIG.maxPages; pi++) {
    const payload = await fetchDexScreenerJson(buildDexScreenerPnlUrl(wallet, beforeBN));
    const logs = Array.isArray(payload.logs) ? payload.logs : [];
    if (!logs.length) { exhaustedHistory=true; break; }
    pageCount++; checkedLogs+=logs.length;
    const bns = [];
    for (const log of logs) {
      const bn=Number(log?.blockNumber);
      if (Number.isFinite(bn)&&bn>0) bns.push(bn);
      const ts=normalizeDexTimestamp(log?.blockTimestamp);
      if (ts) oldestTs=oldestTs==null?ts:Math.min(oldestTs,ts);
      const maker=String(log?.maker||"").toLowerCase();
      if (maker&&maker!==wallet) continue;
      const trade=parseDexScreenerPnlTrade(log);
      if (trade) tradeMap.set(trade.key, trade);
    }
    if (!bns.length) { exhaustedHistory=true; break; }
    const pb=Math.min(...bns), pn=Math.max(...bns);
    oldestBN=oldestBN==null?pb:Math.min(oldestBN,pb);
    newestBN=newestBN==null?pn:Math.max(newestBN,pn);
    if (beforeBN!=null&&pb>=beforeBN) { exhaustedHistory=true; break; }
    beforeBN=pb;
    if (logs.length<100) { exhaustedHistory=true; break; }
    if (pi===PNL_DEXSCREENER_CONFIG.maxPages-1) { hitPageLimit=true; break; }
    if (PNL_DEXSCREENER_CONFIG.pagePauseMs>0) await sleep(PNL_DEXSCREENER_CONFIG.pagePauseMs);
  }
  const trades = Array.from(tradeMap.values()).sort((a,b)=>a.timestamp-b.timestamp);
  const totals = aggregatePnlDexTrades(trades);
  return { ok:true, source:"dexscreener", wallet, totals, trades, meta:{ sourceLabel:"DexScreener", checkedTransactions:tradeMap.size, checkedLogs, pageCount, reachedListingStart:exhaustedHistory, exhaustedHistory, hitPageLimit, oldestTimestamp:oldestTs, oldestBlockNumber:oldestBN, newestBlockNumber:newestBN, cached:false, updatedAt:new Date().toISOString() } };
}

function normalizePnlOperation(op) {
  if (op?.action && op.action!=="transfer") return null;
  const token = op?.identifier || op?.token || (op?.type==="egld"?"EGLD":"");
  if (!token||!op?.value) return null;
  if (op?.esdtType && op.esdtType!=="FungibleESDT") return null;
  const decimals = Number(op.decimals ?? (token===VOLUME_CONFIG.quoteTokenAddress?6:18));
  const amount = decimalStringToNumber(String(op.value), decimals);
  if (!Number.isFinite(amount)||amount<=0) return null;
  const valueUsd = token===VOLUME_CONFIG.quoteTokenAddress ? amount : Number(op.valueUSD);
  return { token, amount, valueUsd, sender:op.sender||"", receiver:op.receiver||"", key:[op.id||"",op.action||"",op.type||"",token,op.sender||"",op.receiver||"",String(op.value||"")].join("|") };
}

function normalizePnlTradeTransfer(t) {
  const token = t?.token||t?.identifier||"";
  if (!token||!t?.value) return null;
  const decimals = Number(t.decimals ?? (token===VOLUME_CONFIG.quoteTokenAddress?6:18));
  const amount = decimalStringToNumber(String(t.value), decimals);
  if (!Number.isFinite(amount)||amount<=0) return null;
  return { token, amount };
}

function groupPnlTransfers(transfers) {
  const groups = new Map();
  for (const entry of Array.isArray(transfers)?transfers:[]) {
    if (entry?.status && entry.status!=="success") continue;
    const hash = String(entry?.originalTxHash||entry?.txHash||"");
    if (!hash) continue;
    let g = groups.get(hash);
    const ts = Number(entry.timestamp)||0;
    if (!g) { g={hash,timestamp:ts,entries:[]}; groups.set(hash,g); }
    else if (ts&&(!g.timestamp||ts<g.timestamp)) g.timestamp=ts;
    g.entries.push(entry);
  }
  return groups;
}

function parsePnlPairActionTrades(transfers, wallet) {
  const groupedSwaps = new Map();
  for (const entry of Array.isArray(transfers)?transfers:[]) {
    if (entry?.status&&entry.status!=="success") continue;
    const tl=entry?.action?.arguments?.transfers;
    if (!Array.isArray(tl)||!tl.length) continue;
    const pt=normalizePnlTradeTransfer(tl[0]);
    if (!pt) continue;
    const ts=Number(entry.timestamp);
    if (!Number.isFinite(ts)) continue;
    const hash=String(entry.originalTxHash||entry.txHash||"");
    if (!hash) continue;
    let gs=groupedSwaps.get(hash);
    if (!gs) { gs={hash,timestamp:ts,inputToken:null,inputAmount:0,outputToken:null,outputAmount:0,invalid:false}; groupedSwaps.set(hash,gs); }
    else if (ts<gs.timestamp) gs.timestamp=ts;
    const isSwapInput=entry.sender===wallet&&entry.receiver===VOLUME_CONFIG.pairAddress&&(/^swap/i.test(String(entry.function||""))||entry?.action?.name==="swap");
    if (isSwapInput) { if (gs.inputToken&&gs.inputToken!==pt.token){gs.invalid=true;continue;} gs.inputToken=pt.token; gs.inputAmount+=pt.amount; continue; }
    const isPairOutput=entry.sender===VOLUME_CONFIG.pairAddress&&entry.receiver===wallet&&entry.function!=="depositSwapFees"&&(pt.token===VOLUME_CONFIG.baseTokenAddress||pt.token===VOLUME_CONFIG.quoteTokenAddress);
    if (!isPairOutput) continue;
    if (gs.outputToken&&gs.outputToken!==pt.token){gs.invalid=true;continue;} gs.outputToken=pt.token; gs.outputAmount+=pt.amount;
  }
  const trades=[];
  for (const gs of groupedSwaps.values()) {
    if (gs.invalid||!gs.inputToken||!gs.outputToken||gs.inputAmount<=0||gs.outputAmount<=0) continue;
    let side="", tclAmount=0, volumeUsd=0;
    if (gs.inputToken===VOLUME_CONFIG.quoteTokenAddress&&gs.outputToken===VOLUME_CONFIG.baseTokenAddress) { side="buy"; tclAmount=gs.outputAmount; volumeUsd=gs.inputAmount; }
    else if (gs.inputToken===VOLUME_CONFIG.baseTokenAddress&&gs.outputToken===VOLUME_CONFIG.quoteTokenAddress) { side="sell"; tclAmount=gs.inputAmount; volumeUsd=gs.outputAmount; }
    if (!side||!Number.isFinite(tclAmount)||tclAmount<=0||!Number.isFinite(volumeUsd)||volumeUsd<=0) continue;
    trades.push({ hash:gs.hash, timestamp:gs.timestamp, side, tclAmount, volumeUsd, price:volumeUsd/tclAmount, description:"MultiversX pair transfer" });
  }
  return trades;
}

function parsePnlOperationTrades(transfers, wallet) {
  const trades=[];
  for (const group of groupPnlTransfers(transfers).values()) {
    const seen=new Set(), ops=[];
    for (const entry of group.entries) {
      if (!Array.isArray(entry.operations)) continue;
      for (const raw of entry.operations) {
        const op=normalizePnlOperation(raw);
        if (!op||seen.has(op.key)) continue;
        seen.add(op.key); ops.push(op);
      }
    }
    if (!ops.length) continue;
    const tclSent=ops.filter(o=>o.token===VOLUME_CONFIG.baseTokenAddress&&o.sender===wallet).reduce((s,o)=>s+o.amount,0);
    const tclReceived=ops.filter(o=>o.token===VOLUME_CONFIG.baseTokenAddress&&o.receiver===wallet).reduce((s,o)=>s+o.amount,0);
    const usdSent=ops.filter(o=>o.token!==VOLUME_CONFIG.baseTokenAddress&&o.sender===wallet&&Number.isFinite(o.valueUsd)).reduce((s,o)=>s+o.valueUsd,0);
    const usdReceived=ops.filter(o=>o.token!==VOLUME_CONFIG.baseTokenAddress&&o.receiver===wallet&&Number.isFinite(o.valueUsd)).reduce((s,o)=>s+o.valueUsd,0);
    const tclSentUsd=ops.filter(o=>o.token===VOLUME_CONFIG.baseTokenAddress&&o.sender===wallet&&Number.isFinite(o.valueUsd)).reduce((s,o)=>s+o.valueUsd,0);
    const tclReceivedUsd=ops.filter(o=>o.token===VOLUME_CONFIG.baseTokenAddress&&o.receiver===wallet&&Number.isFinite(o.valueUsd)).reduce((s,o)=>s+o.valueUsd,0);
    const hasNonTclSent=ops.some(o=>o.token!==VOLUME_CONFIG.baseTokenAddress&&o.sender===wallet);
    const hasNonTclReceived=ops.some(o=>o.token!==VOLUME_CONFIG.baseTokenAddress&&o.receiver===wallet);
    const pairInvolved=group.entries.some(e=>e.sender===VOLUME_CONFIG.pairAddress||e.receiver===VOLUME_CONFIG.pairAddress)||ops.some(o=>o.sender===VOLUME_CONFIG.pairAddress||o.receiver===VOLUME_CONFIG.pairAddress);
    const netTcl=tclReceived-tclSent, netUsd=usdReceived-usdSent;
    const buyFallbackUsd=(hasNonTclSent||pairInvolved)&&tclReceivedUsd>0?tclReceivedUsd:0;
    const sellFallbackUsd=(hasNonTclReceived||pairInvolved)&&tclSentUsd>0?tclSentUsd:0;
    let side="", tclAmount=0, volumeUsd=0;
    if (netTcl>0&&netUsd<0) { side="buy"; tclAmount=netTcl; volumeUsd=Math.abs(netUsd); }
    else if (netTcl<0&&netUsd>0) { side="sell"; tclAmount=Math.abs(netTcl); volumeUsd=netUsd; }
    else if (netTcl>0&&buyFallbackUsd>0) { side="buy"; tclAmount=netTcl; volumeUsd=buyFallbackUsd; }
    else if (netTcl<0&&sellFallbackUsd>0) { side="sell"; tclAmount=Math.abs(netTcl); volumeUsd=sellFallbackUsd; }
    else if (tclReceived>0&&usdSent>0) { side="buy"; tclAmount=tclReceived; volumeUsd=usdSent; }
    else if (tclSent>0&&usdReceived>0) { side="sell"; tclAmount=tclSent; volumeUsd=usdReceived; }
    if (!side||!Number.isFinite(tclAmount)||tclAmount<=0||!Number.isFinite(volumeUsd)||volumeUsd<=0) continue;
    trades.push({ hash:group.hash, timestamp:group.timestamp, side, tclAmount, volumeUsd, price:volumeUsd/tclAmount, description:"MultiversX wallet operations" });
  }
  return trades;
}

function parseFilteredPnlTrades(transfers, wallet) {
  const merged=new Map();
  for (const t of parsePnlPairActionTrades(transfers, wallet)) merged.set(t.hash, t);
  for (const t of parsePnlOperationTrades(transfers, wallet)) merged.set(t.hash, t);
  return Array.from(merged.values()).sort((a,b)=>a.timestamp-b.timestamp);
}

async function fetchMvxPnlSource(account, params, maxPages) {
  const transfers=[]; let hitPageLimit=false, exhaustedHistory=false, oldestTs=null;
  for (let pi=0; pi<maxPages; pi++) {
    const url=new URL(`${PNL_MVX_CONFIG.apiBase}/accounts/${account}/transfers`);
    url.searchParams.set("from",String(pi*PNL_MVX_CONFIG.pageSize)); url.searchParams.set("size",String(PNL_MVX_CONFIG.pageSize));
    url.searchParams.set("status","success"); url.searchParams.set("withOperations","true"); url.searchParams.set("order","desc");
    for (const [k,v] of Object.entries(params)) { if (v!==undefined&&v!==null&&v!=="") url.searchParams.set(k,String(v)); }
    const page=await fetchAnalyticsJson(url.toString(), PNL_MVX_CONFIG.maxAttempts);
    if (!Array.isArray(page)||!page.length) { exhaustedHistory=true; break; }
    transfers.push(...page);
    const pts=page.map(i=>Number(i?.timestamp)).filter(Number.isFinite);
    if (pts.length) oldestTs=oldestTs==null?Math.min(...pts):Math.min(oldestTs,...pts);
    if (page.length<PNL_MVX_CONFIG.pageSize) { exhaustedHistory=true; break; }
    if (pi===maxPages-1) { hitPageLimit=true; break; }
    if (PNL_MVX_CONFIG.pagePauseMs>0) await sleep(PNL_MVX_CONFIG.pagePauseMs);
  }
  return { transfers, hitPageLimit, exhaustedHistory, oldestTimestamp:oldestTs };
}

async function fetchMultiversXFilteredPnl(wallet, warnings=[]) {
  const sources=[
    { label:"TCL wallet transfers",    account:wallet, params:{ token:VOLUME_CONFIG.baseTokenAddress }, maxPages:PNL_MVX_CONFIG.tokenMaxPages },
    { label:"wallet to TCL/USDC pair", account:wallet, params:{ receiver:VOLUME_CONFIG.pairAddress },   maxPages:PNL_MVX_CONFIG.pairMaxPages },
    { label:"TCL/USDC pair to wallet", account:wallet, params:{ sender:VOLUME_CONFIG.pairAddress },     maxPages:PNL_MVX_CONFIG.pairMaxPages }
  ];
  const transferMap=new Map(); let hitPageLimit=false, exhaustedHistory=true, oldestTs=null;
  const sourceMeta=[];
  for (const src of sources) {
    const result=await fetchMvxPnlSource(src.account, src.params, src.maxPages);
    sourceMeta.push({ label:src.label, transfers:result.transfers.length, hitPageLimit:result.hitPageLimit, exhaustedHistory:result.exhaustedHistory, oldestTimestamp:result.oldestTimestamp });
    hitPageLimit=hitPageLimit||result.hitPageLimit; exhaustedHistory=exhaustedHistory&&result.exhaustedHistory;
    if (result.oldestTimestamp!=null) oldestTs=oldestTs==null?result.oldestTimestamp:Math.min(oldestTs,result.oldestTimestamp);
    result.transfers.forEach((entry,idx) => {
      const key=[entry?.txHash||entry?.originalTxHash||idx, entry?.type||"", entry?.sender||"", entry?.receiver||"", entry?.timestamp||""].join("|");
      transferMap.set(key, entry);
    });
  }
  const transfers=Array.from(transferMap.values());
  const trades=parseFilteredPnlTrades(transfers, wallet);
  const totals=aggregatePnlDexTrades(trades);
  return { ok:true, source:"multiversx-filtered", wallet, totals, meta:{ sourceLabel:"MultiversX filtered", checkedTransactions:trades.length, checkedTransfers:transfers.length, sourceMeta, reachedListingStart:!hitPageLimit, exhaustedHistory, hitPageLimit, oldestTimestamp:oldestTs, cached:false, warnings, updatedAt:new Date().toISOString() } };
}

// ── AI Chat helpers ─────────────────────────────────────────────────────────────

const AI_MAX_QUESTION_CHARS = 800;
const AI_MAX_CONTEXT_CHARS  = 8000;
const AI_DEFAULT_MODEL      = "gemini-2.0-flash";
const AI_GEMINI_KEY         = process.env.GEMINI_API_KEY || "";

async function searchKnowledgeDb(question) {
  const matchCount = 10;
  const queryText  = question.trim().slice(0, 500);
  try {
    const rows = await db.all(
      "SELECT id, source_url, title, chunk, (1 - (embedding <=> (SELECT embedding FROM ai_knowledge_chunks WHERE chunk ILIKE $2 LIMIT 1))) AS rank FROM ai_knowledge_chunks WHERE active = true ORDER BY embedding <=> (SELECT embedding FROM ai_knowledge_chunks WHERE content_hash = md5(chunk) LIMIT 1) LIMIT $1",
      [matchCount * 2, `%${queryText.slice(0, 80)}%`]
    );
    return rows.filter(r => r && r.chunk).slice(0, matchCount);
  } catch {
    // Fallback: simple text search if pgvector not available
    try {
      const rows = await db.all(
        "SELECT id, source_url, title, chunk, 0.5 AS rank FROM ai_knowledge_chunks WHERE active = true AND (chunk ILIKE $1 OR title ILIKE $1) LIMIT $2",
        [`%${queryText.slice(0, 80)}%`, matchCount]
      );
      return rows;
    } catch { return []; }
  }
}

async function searchKnowledgeRpc(question) {
  // Use the PostgreSQL RPC function ai_match_knowledge_chunks if available
  try {
    const rows = await db.all(
      "SELECT * FROM ai_match_knowledge_chunks($1, $2)",
      [question.trim().slice(0, 500), 10]
    );
    return Array.isArray(rows) ? rows.filter(r => r && r.chunk) : [];
  } catch {
    return searchKnowledgeDb(question);
  }
}

function buildAiContext(matches) {
  let used = 0;
  const blocks = [];
  for (const [idx, m] of matches.entries()) {
    const block = [`[${idx+1}] ${m.title||"Untitled"}`, `URL: ${m.source_url||""}`, String(m.chunk||"").trim()].join("\n");
    if (used + block.length > AI_MAX_CONTEXT_CHARS) break;
    used += block.length;
    blocks.push(block);
  }
  return blocks.join("\n\n---\n\n");
}

async function generateAiAnswer(question, matches, language, history=[]) {
  const model = String(process.env.GEMINI_MODEL || AI_DEFAULT_MODEL).trim() || AI_DEFAULT_MODEL;
  const context = buildAiContext(matches);
  const systemText = `You are Companion, a friendly assistant for The Cursed Land players on TCLexplorer. Rules:
- Reply in ${language === "ro" ? "Romanian" : "English"} with correct, natural grammar.
- Be conversational. For yes/no questions start with "Da," or "Nu," (Romanian) / "Yes," or "No," (English).
- Answer ONLY what was asked. If context lacks the answer, say you don't know simply.
- Never invent mechanics, stats, percentages, or dates not found in context.
- Plain text only, no markdown, no raw URLs. Keep answers concise (2-4 sentences max).`;
  const parts = [`Player language: ${language}`, "", "RAG context:", context, "", "Player question:", question];
  const prompt = parts.join("\n");
  const historyContents = (history||[]).slice(-4).map(h => ({ role: h.role==="assistant"?"model":"user", parts: [{ text: h.content }] }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${AI_GEMINI_KEY}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: [...historyContents, { role:"user", parts:[{ text: prompt }] }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 260 }
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) {
    const details = await r.text().catch(()=>"");
    if (r.status === 429) { const e = new Error("Gemini quota exceeded"); e.code="GEMINI_QUOTA"; throw e; }
    throw new Error(`Gemini API HTTP ${r.status}: ${details.slice(0,300)}`);
  }
  const payload = await r.json();
  const text = (payload.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("\n").trim();
  return text
    .replace(/\*\*/g,"").replace(/^\s*[-*]\s+/gm,"").replace(/\s+/g," ").trim() || "I don't have information about that.";
}

// ══════════════════════════════════════════════════════════════════════════════
//  ANALYTICS API  —  /api/analytics
// ══════════════════════════════════════════════════════════════════════════════

app.get("/api/analytics", async (req, res) => {
  try {
    const CACHE_KEY = "analytics:snapshot";
    const TTL_MS    = 15 * 60 * 1000; // 15 minutes
    let snapshot = cacheGet(CACHE_KEY);
    if (!snapshot) {
      snapshot = await buildAnalyticsSnapshot();
      cacheSet(CACHE_KEY, snapshot, TTL_MS);
    }
    ok(res, snapshot);
  } catch (e) {
    console.error("Analytics error:", e.message);
    fail(res, "Analytics unavailable: " + e.message, 502);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  VOLUME API  —  /api/volume
// ══════════════════════════════════════════════════════════════════════════════

app.get("/api/volume", async (req, res) => {
  try {
    const CACHE_KEY = "volume:snapshot";
    const TTL_MS    = 5 * 60 * 1000; // 5 minutes
    let snapshot = cacheGet(CACHE_KEY);
    if (!snapshot) {
      snapshot = await buildVolumeSnapshot(null);
      cacheSet(CACHE_KEY, snapshot, TTL_MS);
    } else {
      // Refresh in background if stale (older than 4 min)
      const updatedAt = snapshot?.meta?.updatedAt ? new Date(snapshot.meta.updatedAt).getTime() : 0;
      if (Date.now() - updatedAt > 4 * 60 * 1000) {
        buildVolumeSnapshot(snapshot).then(s => cacheSet(CACHE_KEY, s, TTL_MS)).catch(e => console.error("Volume bg refresh:", e.message));
      }
    }
    ok(res, snapshot);
  } catch (e) {
    console.error("Volume error:", e.message);
    // Fallback to seed snapshot
    const fallback = {
      ok: true,
      meta: { updatedAt: new Date().toISOString(), source: "Server API (seed fallback)", warnings: [e.message] },
      pair: null,
      aggregated: rebuildVolumeAggregatedDerivedState(normalizeVolumeAggregatedSnapshot(VOLUME_SEED_SNAPSHOT, new Date()))
    };
    ok(res, fallback);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  TECHNICALS API  —  /api/technicals
// ══════════════════════════════════════════════════════════════════════════════

let _technicalsLastGood = null; // survives cache TTL; served stale when MVX 429s
app.get("/api/technicals", async (req, res) => {
  try {
    const CACHE_KEY = "technicals:snapshot";
    const TTL_MS    = 5 * 60 * 1000; // 5 minutes
    let snapshot = cacheGet(CACHE_KEY);
    if (!snapshot) {
      try {
        snapshot = await buildTechnicalsSnapshot(_technicalsLastGood);
        cacheSet(CACHE_KEY, snapshot, TTL_MS);
        _technicalsLastGood = snapshot;
      } catch (buildErr) {
        // api.multiversx.com transfers 429 → serve last-good instead of 502.
        if (_technicalsLastGood) {
          return ok(res, { ..._technicalsLastGood, meta: { ...(_technicalsLastGood.meta || {}), stale: true } });
        }
        throw buildErr;
      }
    } else {
      // Refresh in background if stale
      const updatedAt = snapshot?.meta?.updatedAt ? new Date(snapshot.meta.updatedAt).getTime() : 0;
      if (Date.now() - updatedAt > 4 * 60 * 1000) {
        buildTechnicalsSnapshot(snapshot)
          .then(s => { cacheSet(CACHE_KEY, s, TTL_MS); _technicalsLastGood = s; })
          .catch(e => console.error("Technicals bg refresh:", e.message));
      }
    }
    ok(res, snapshot);
  } catch (e) {
    console.error("Technicals error:", e.message);
    fail(res, "Technicals unavailable: " + e.message, 502);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  AI CHAT  —  /ai/chat
// ══════════════════════════════════════════════════════════════════════════════

app.post("/ai/chat", async (req, res) => {
  try {
    const question = String(req.body?.message || req.body?.question || "").trim().slice(0, AI_MAX_QUESTION_CHARS);
    if (!question) return fail(res, "Missing message.");
    if (!AI_GEMINI_KEY) return fail(res, "AI chat not configured.", 503);

    const language = String(req.body?.language || "en").slice(0, 10);
    const history  = Array.isArray(req.body?.history)
      ? req.body.history.filter(h => h && (h.role==="user"||h.role==="assistant") && typeof h.content==="string" && h.content.length>0).slice(-6).map(h => ({ role:h.role, content:String(h.content).slice(0,600) }))
      : [];

    const matches = await searchKnowledgeRpc(question);
    const sources = matches.map(m => ({ title:m.title||"", url:m.source_url||"" })).filter(s=>s.url);

    let answer;
    try {
      answer = await generateAiAnswer(question, matches, language, history);
    } catch (e) {
      if (e.code === "GEMINI_QUOTA") return fail(res, "AI quota exceeded, please try again later.", 429);
      throw e;
    }

    // Log chat asynchronously (fire and forget)
    db.query(
      "INSERT INTO ai_chat_logs (question, answer, matched_sources, language, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT DO NOTHING",
      [question.slice(0, AI_MAX_QUESTION_CHARS), answer.slice(0, 8000), JSON.stringify(sources), language]
    ).catch(e => console.warn("Chat log failed:", e.message));

    ok(res, { ok:true, answer, sources, language });
  } catch (e) {
    console.error("AI chat error:", e.message);
    fail(res, "AI chat unavailable.", 502);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  BURN HISTORY  —  /api/burn-history
// ══════════════════════════════════════════════════════════════════════════════

let _burnCache    = null;
let _burnCacheTs  = 0;
let _burnSyncedAt = 0; // tracks tcl_burns last write (from tcl_sync_state)
const BURN_CACHE_TTL = 5 * 60 * 1000; // 5 min

app.get("/api/burn-history", async (req, res) => {
  // Public read-only stats — allow any origin (file://, embedded, etc.)
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    // Invalidate cache if sync-burns.js wrote new data since last cache fill
    let syncedAt = _burnSyncedAt;
    try {
      const row = await db.one("SELECT value FROM tcl_sync_state WHERE key='burns_updated_at'");
      syncedAt = Number(row?.value || "0");
    } catch (_) {}

    if (_burnCache && Date.now() - _burnCacheTs < BURN_CACHE_TTL && syncedAt <= _burnSyncedAt) {
      return ok(res, _burnCache);
    }

    // ── Primary: tcl_burns table (populated by sync-burns.js) ──────────────
    const burnRows = await db.all(
      "SELECT tx_hash, ts, amount_raw, wallet, fn FROM tcl_burns ORDER BY ts ASC"
    );

    let events = [];
    let source = "legacy";

    if (burnRows.length > 0) {
      source = "indexed";
      for (const row of burnRows) {
        try {
          const raw = BigInt(String(row.amount_raw || "0"));
          if (raw <= 0n) continue;
          events.push({
            timestamp: Number(row.ts),
            burnt:     parseFloat(rawToDecimal(raw)),
            wallet:    String(row.wallet || ""),
            txHash:    String(row.tx_hash || ""),
          });
        } catch (_) {}
      }
    } else {
      // ── Fallback: tcl_transfers JSONB operations + computed buyCoins ──────
      source = "legacy";
      const rawRows = await db.all(`
        SELECT tx_hash, original_tx_hash, ts, sender, operations
        FROM tcl_transfers
        WHERE status = 'success'
          AND operations IS NOT NULL
          AND jsonb_typeof(operations) = 'array'
          AND operations @> $1::jsonb
        ORDER BY ts ASC
      `, [JSON.stringify([{ action: "localBurn", identifier: TCL_TOKEN }])]);

      const seen = new Set();
      for (const row of rawRows) {
        try {
          const ops = Array.isArray(row.operations)
            ? row.operations
            : JSON.parse(row.operations);
          if (!Array.isArray(ops)) continue;
          for (const op of ops) {
            if (op?.action !== "localBurn" || op?.identifier !== TCL_TOKEN) continue;
            const raw = BigInt(String(op.value || "0"));
            if (raw <= 0n) continue;
            const txKey = String(row.tx_hash || row.original_tx_hash || "");
            if (seen.has(txKey)) continue;
            seen.add(txKey);
            events.push({
              timestamp: Number(row.ts),
              burnt:     parseFloat(rawToDecimal(raw)),
              wallet:    String(row.sender || ""),
              txHash:    txKey,
            });
          }
        } catch (_) {}
      }

      // Merge computed buyCoins burns (tcl_sync_state) to fill missing period
      const onChainHashes = new Set(events.map(e => e.txHash));
      const syncRows = await db.all(
        "SELECT value FROM tcl_sync_state WHERE key LIKE $1 ORDER BY key ASC",
        [BUY_COINS_ROW_PREFIX + "%"]
      );
      for (const row of syncRows) {
        try {
          const tx = JSON.parse(row.value || "{}");
          if (!tx.txHash || !tx.timestamp || !tx.burntRaw) continue;
          if (onChainHashes.has(tx.txHash)) continue;
          const burntVal = parseFloat(rawToDecimal(tx.burntRaw));
          if (!burntVal || burntVal <= 0) continue;
          events.push({
            timestamp: Number(tx.timestamp),
            burnt:     burntVal,
            wallet:    String(tx.wallet || ""),
            txHash:    String(tx.txHash),
          });
        } catch (_) {}
      }
    }

    events.sort((a, b) => a.timestamp - b.timestamp);

    // Group by UTC day
    const dailyMap = new Map();
    for (const e of events) {
      const date = new Date(e.timestamp * 1000).toISOString().slice(0, 10);
      const day = dailyMap.get(date) || { date, burnt: 0, txCount: 0 };
      day.burnt += e.burnt;
      day.txCount++;
      dailyMap.set(date, day);
    }

    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    let cum = 0;
    for (const d of daily) {
      cum += d.burnt;
      d.cumulative = parseFloat(cum.toFixed(4));
      d.burnt      = parseFloat(d.burnt.toFixed(4));
    }

    const totalBurnt = parseFloat(cum.toFixed(4));
    const firstTs    = events.length ? events[0].timestamp : null;
    const lastTs     = events.length ? events[events.length - 1].timestamp : null;
    const daySpan    = (firstTs && lastTs && lastTs > firstTs)
      ? Math.max(1, (lastTs - firstTs) / 86400)
      : 1;
    const avgPerDay  = parseFloat((totalBurnt / daySpan).toFixed(4));

    const recentEvents = events.slice(-100).reverse().map(e => ({
      timestamp: e.timestamp,
      date: new Date(e.timestamp * 1000).toISOString(),
      burnt: parseFloat(e.burnt.toFixed(4)),
      wallet: e.wallet,
      txHash: e.txHash,
    }));

    const payload = {
      ok: true,
      source,
      totalBurnt,
      avgPerDay,
      txCount: events.length,
      firstBurnAt: firstTs,
      latestBurnAt: lastTs,
      daily,
      recentEvents,
    };
    _burnCache    = payload;
    _burnCacheTs  = Date.now();
    _burnSyncedAt = syncedAt;
    ok(res, payload);
  } catch (err) {
    fail(res, err.message || "Internal error");
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  MVX PROXY  —  cached, gateway-first (so the frontend never calls MultiversX
//  directly and api.multiversx.com is hit at most once per TTL per resource).
//  gateway.multiversx.com is NOT rate-limited, unlike api.multiversx.com.
// ══════════════════════════════════════════════════════════════════════════════

const PROXY_TTL = {
  account: 30 * 1000,
  scQuery: 60 * 1000,
  prices:  30 * 1000,
};

function allowPublic(res) { res.setHeader("Access-Control-Allow-Origin", "*"); }

// GET /api/account/:address — EGLD balance + TCL balance, from the gateway.
app.get("/api/account/:address", async (req, res) => {
  allowPublic(res);
  const address = String(req.params.address || "");
  if (!address.startsWith("erd1") || address.length < 60) return fail(res, "Invalid address");
  const cacheKey = `account:${address}`;
  const cached = cacheGet(cacheKey);
  if (cached) return ok(res, { ...cached, cached: true });
  try {
    // /address/{addr} gives balance + nonce; /address/{addr}/esdt/{token} the TCL balance.
    const [accResp, tclResp] = await Promise.all([
      fetch(`${MVX_GATEWAY}/address/${address}`, { signal: AbortSignal.timeout(10000) }),
      fetch(`${MVX_GATEWAY}/address/${address}/esdt/${TCL_TOKEN}`, { signal: AbortSignal.timeout(10000) }),
    ]);
    const accJson = accResp.ok ? await accResp.json() : null;
    const tclJson = tclResp.ok ? await tclResp.json() : null;
    const egldRaw = String(accJson?.data?.account?.balance || "0");
    const tclRaw  = String(tclJson?.data?.tokenData?.balance || "0");
    const payload = {
      ok: true,
      address,
      egldBalance: parseFloat(rawToDecimal(BigInt(egldRaw || "0"))),
      egldBalanceRaw: egldRaw,
      tclBalance: parseFloat(rawToDecimal(BigInt(tclRaw || "0"))),
      tclBalanceRaw: tclRaw,
      nonce: Number(accJson?.data?.account?.nonce || 0),
      username: String(accJson?.data?.account?.username || ""),
      updatedAt: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, PROXY_TTL.account);
    ok(res, payload);
  } catch (err) {
    fail(res, err.message || "account fetch failed", 502);
  }
});

// POST /api/sc-query — generic smart-contract view query via the gateway.
//  Body: { scAddress, funcName, args?: [hexString...] }
//  Response mirrors api.multiversx.com/query: { returnData:[base64...], returnCode, returnMessage }.
app.post("/api/sc-query", async (req, res) => {
  allowPublic(res);
  const { scAddress, funcName, args = [] } = req.body || {};
  if (!scAddress || !funcName) return fail(res, "scAddress and funcName required");
  const argList = Array.isArray(args) ? args.map(String) : [];
  const cacheKey = `scq:${scAddress}:${funcName}:${argList.join(",")}`;
  const cached = cacheGet(cacheKey);
  if (cached) return ok(res, { ...cached, cached: true });
  try {
    const r = await fetch(`${MVX_GATEWAY}/vm-values/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ scAddress, funcName, args: argList }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await r.json();
    const inner = j?.data?.data || {};
    const payload = {
      ok: true,
      returnData: inner.returnData || [],
      returnCode: inner.returnCode || j?.code || "",
      returnMessage: inner.returnMessage || "",
    };
    cacheSet(cacheKey, payload, PROXY_TTL.scQuery);
    ok(res, payload);
  } catch (err) {
    fail(res, err.message || "sc-query failed", 502);
  }
});

// GET /api/prices — TCL (and pair stats) from DexScreener, cached server-side.
app.get("/api/prices", async (req, res) => {
  allowPublic(res);
  const cacheKey = "prices:tcl";
  const cached = cacheGet(cacheKey);
  if (cached) return ok(res, { ...cached, cached: true });
  try {
    const d = await fetch(VOLUME_CONFIG.dexUrl, { signal: AbortSignal.timeout(10000) }).then(r => r.json());
    const pair = d?.pairs?.[0] || d?.pair || {};
    const payload = {
      ok: true,
      tcl: {
        priceUsd:    parseFloat(pair?.priceUsd || 0) || 0,
        priceChange: pair?.priceChange || {},
        liquidityUsd: parseFloat(pair?.liquidity?.usd || 0) || 0,
        volume24h:   parseFloat(pair?.volume?.h24 || 0) || 0,
        fdv:         parseFloat(pair?.fdv || 0) || 0,
      },
      updatedAt: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, PROXY_TTL.prices);
    ok(res, payload);
  } catch (err) {
    fail(res, err.message || "prices fetch failed", 502);
  }
});

// GET /api/holders?size=N — TCL holder list (array of { address, balance }),
//  served from the DB snapshot written by sync-holders.js (the list lives only on
//  api.multiversx.com, which 429s the VPS IP — so we never proxy it live here).
app.get("/api/holders", async (req, res) => {
  allowPublic(res);
  const size = Math.min(Math.max(Number(req.query.size) || 500, 1), 10000);
  try {
    const row = await db.one("SELECT value FROM tcl_sync_state WHERE key='holders_snapshot'");
    const tsRow = await db.one("SELECT value FROM tcl_sync_state WHERE key='holders_updated_at'");
    if (!row?.value) return fail(res, "holders snapshot not available yet", 503);
    const arr = JSON.parse(row.value);
    res.setHeader("X-Holders-Updated-At", String(tsRow?.value || ""));
    res.json(Array.isArray(arr) ? arr.slice(0, size) : []);
  } catch (err) {
    fail(res, err.message || "holders read failed", 500);
  }
});

// GET /api/pnl/:address — TCL swap buy/sell PNL totals, computed server-side from
//  our indexed tcl_transfers (no heavy data sent to the browser). Logic ported
//  verbatim from pnlCheck.html (pnl-compute.mjs) so numbers match the old client path.
app.get("/api/pnl/:address", async (req, res) => {
  allowPublic(res);
  const address = String(req.params.address || "");
  if (!address.startsWith("erd1") || address.length < 60) return fail(res, "Invalid address");
  const cacheKey = `pnl:${address}`;
  const cached = cacheGet(cacheKey);
  if (cached) return ok(res, { ...cached, cached: true });
  try {
    const [totals, earned] = await Promise.all([
      computeWalletSwapPnl(pool, address),
      computeWalletEarned(pool, address),
    ]);
    const payload = { ok: true, source: "server", ...totals, earned, updatedAt: new Date().toISOString() };
    cacheSet(cacheKey, payload, 60 * 1000); // 1 min — sync-pnl refreshes the DB every 10 min
    ok(res, payload);
  } catch (err) {
    fail(res, err.message || "pnl compute failed", 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  LEADERBOARD (generat de leaderboard.py via cron)
// ══════════════════════════════════════════════════════════════════════════════
const LEADERBOARD_PATH = "/opt/tcl-api/leaderboard.json";

app.get("/api/leaderboard", (req, res) => {
  try {
    const stat = statSync(LEADERBOARD_PATH);
    const raw = readFileSync(LEADERBOARD_PATH, "utf8");
    const payload = JSON.parse(raw);
    payload._meta = { last_updated: stat.mtime.toISOString() };
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Last-Modified", stat.mtime.toUTCString());
    res.json(payload);
  } catch {
    res.status(503).json({ ok: false, error: "Leaderboard not available yet" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  SYNC STATUS — monitor nft-sync.js progress
// ══════════════════════════════════════════════════════════════════════════════
app.get("/api/sync/status", async (req, res) => {
  try {
    let logLines = [];
    try {
      const { execSync } = await import("child_process");
      const raw = execSync("tail -50 /tmp/nft-sync.log 2>/dev/null || echo ''").toString();
      logLines = raw.split("\n").filter(Boolean);
    } catch { logLines = ["Log file not found"]; }

    const lastLine = logLines[logLines.length - 1] || "";
    const done = lastLine.includes("Done!");
    const failed = lastLine.toLowerCase().includes("sync failed") || lastLine.toLowerCase().includes("error");

    // Count indexed NFTs from DB
    const { rows } = await pool.query(
      `SELECT COUNT(*) total,
              COUNT(*) FILTER (WHERE sc_quality IS NOT NULL AND sc_quality > 0) sc_synced
       FROM tcl_nfts`
    );

    res.json({
      status: done ? "done" : failed ? "failed" : "running",
      total_nfts: Number(rows[0].total),
      sc_synced: Number(rows[0].sc_synced),
      log_tail: logLines.slice(-20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  NFT INDEX — serve cached NFTs from DB, avoid hammering MultiversX API
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/nfts/collections
app.get("/api/nfts/collections", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT collection, name, image_url, nft_count, synced_at
       FROM tcl_collections ORDER BY nft_count DESC`
    );
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/nfts/collection/:collection  — all NFTs in a collection
app.get("/api/nfts/collection/:collection", async (req, res) => {
  try {
    const { collection } = req.params;
    const { rows } = await pool.query(
      `SELECT identifier, collection, nonce, name, image_url, metadata, royalties, creator, owner,
              sc_quality, sc_wave, sc_has_bonus, sc_has_crystal,
              sc_socket_count, sc_tcl_count, sc_tcl_max, sc_refinement_ts
       FROM tcl_nfts WHERE collection = $1 ORDER BY nonce ASC`,
      [collection]
    );
    res.setHeader("Cache-Control", "public, max-age=120");
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/nfts/all  — all NFTs, grouped by collection
app.get("/api/nfts/all", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT identifier, collection, nonce, name, image_url, metadata, royalties, creator, owner,
              sc_quality, sc_wave, sc_has_bonus, sc_has_crystal,
              sc_socket_count, sc_tcl_count, sc_tcl_max, sc_refinement_ts
       FROM tcl_nfts ORDER BY collection, nonce ASC`
    );
    // group by collection
    const grouped = {};
    for (const nft of rows) {
      if (!grouped[nft.collection]) grouped[nft.collection] = [];
      grouped[nft.collection].push(nft);
    }
    res.setHeader("Cache-Control", "public, max-age=120");
    res.json(grouped);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/nfts/wallet/:address  — NFTs owned by address
app.get("/api/nfts/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { rows } = await pool.query(
      `SELECT identifier, collection, nonce, name, image_url, metadata, royalties, creator, owner,
              sc_quality, sc_wave, sc_has_bonus, sc_has_crystal,
              sc_socket_count, sc_tcl_count, sc_tcl_max, sc_refinement_ts
       FROM tcl_nfts WHERE owner = $1 ORDER BY collection, nonce ASC`,
      [address]
    );
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/nfts/:identifier  — single NFT
app.get("/api/nfts/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const { rows } = await pool.query(
      `SELECT identifier, collection, nonce, name, image_url, metadata, royalties, creator, owner,
              sc_quality, sc_wave, sc_has_bonus, sc_has_crystal,
              sc_socket_count, sc_tcl_count, sc_tcl_max, sc_refinement_ts, raw_api
       FROM tcl_nfts WHERE identifier = $1`,
      [identifier]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const nft = rows[0];
    // reshape to match MultiversX API format expected by frontend
    nft.media = nft.image_url ? [{ url: nft.image_url }] : [];
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(nft);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/nfts/sync  — trigger manual sync (admin only)
app.post("/api/nfts/sync", async (req, res) => {
  const secret = req.headers["x-admin-secret"] || "";
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET)
    return res.status(401).json({ error: "Unauthorized" });

  res.json({ ok: true, message: "Sync started in background" });

  // fire-and-forget — run sync-nfts.js as child process
  import("child_process").then(({ spawn }) => {
    const proc = spawn("node", ["/opt/tcl-api/sync-nfts.js"], {
      detached: true, stdio: "ignore",
    });
    proc.unref();
  }).catch(console.error);
});

// ══════════════════════════════════════════════════════════════════════════════
//  MARKETPLACE — sales history + sync
// ══════════════════════════════════════════════════════════════════════════════
const MARKETPLACE_SC = "erd1qqqqqqqqqqqqqpgqfs74tc3e6k9lx6s67chyxylyjvscppu7fqmsypuu25";
// ── Bech32 helpers for server-side address decoding ───────────────────────
const _B32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function _b32Polymod(vals) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of vals) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) chk ^= (b >> i) & 1 ? G[i] : 0;
  }
  return chk;
}
function _b32Expand(hrp) {
  return [...hrp].map(c => c.charCodeAt(0) >> 5).concat([0], [...hrp].map(c => c.charCodeAt(0) & 31));
}
function _b32Checksum(hrp, data) {
  const poly = _b32Polymod(_b32Expand(hrp).concat(data, [0,0,0,0,0,0])) ^ 1;
  return Array.from({length: 6}, (_, i) => (poly >> (5 * (5 - i))) & 31);
}
function _convertBits(data, from, to) {
  let acc = 0, bits = 0; const ret = [], maxv = (1 << to) - 1;
  for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; ret.push((acc >> bits) & maxv); } }
  if (bits) ret.push((acc << (to - bits)) & maxv);
  return ret;
}
function bytesToErd(bytes32) {
  const d = _convertBits(Array.from(bytes32), 8, 5);
  return "erd1" + [...d, ..._b32Checksum("erd", d)].map(x => _B32_CHARSET[x]).join("");
}
function nonceToHex(nonce) {
  let h = BigInt(nonce).toString(16);
  return h.length % 2 ? "0" + h : h;
}

// ── Decode getListing response (mirrors frontend decodeListingStruct) ──────
function decodeListingStruct(base64Data) {
  const bytes = Buffer.from(base64Data, "base64");
  let off = 0;
  const take = n => { const v = bytes.slice(off, off + n); off += n; return v; };
  const readU32 = () => take(4).readUInt32BE(0);
  const readU64 = () => Number(take(8).readBigUInt64BE(0));
  const readAddr = () => bytesToErd(take(32));
  const readNested = () => take(readU32());
  const readBigUint = () => { const b = readNested(); return b.reduce((a, x) => a * 256n + BigInt(x), 0n); };
  return {
    listing_id:      readU64(),
    seller:          readAddr(),
    nft_token:       readNested().toString("utf8"),
    nft_nonce:       readU64(),
    price:           readBigUint(),
    royalty_address: readAddr(),
    royalty_percent: readU64(),
    timestamp:       readU64(),
    is_active:       take(1)[0] === 1,
  };
}


// ── Sync all marketplace SC events (listNFT, cancelListing, updatePrice, buyNFT) ──
let _eventsSyncRunning = false;
async function syncMarketplaceEvents() {
  if (_eventsSyncRunning) return;
  _eventsSyncRunning = true;
  try {
    const pageSize = 50;
    let from = 0;
    let indexed = 0;
    const cancelledIds = [];
    let hasNewListings = false;

    while (true) {
      const txs = await fetchMarketplaceSource("sc-events", { from, size: pageSize });
      if (!Array.isArray(txs) || !txs.length) break;

      const hashes = txs.map(tx => tx.txHash).filter(Boolean);
      const { rows: existingRows } = await pool.query(
        "SELECT tx_hash FROM tcl_marketplace_events WHERE tx_hash = ANY($1)",
        [hashes]
      );
      const existingSet = new Set(existingRows.map(r => r.tx_hash));
      const newTxs = txs.filter(tx => !existingSet.has(tx.txHash));

      if (!newTxs.length) break;

      for (const tx of newTxs) {
        try {
          const func = tx.function || "";
          const sender = tx.sender || null;
          const ts = tx.timestamp ? new Date(tx.timestamp * 1000) : null;
          let listingId = null;

          if ((func === "cancelListing" || func === "updatePrice") && tx.data) {
            try {
              const raw = Buffer.from(tx.data, "base64").toString("utf8");
              const parts = raw.split("@");
              if (parts.length >= 2 && parts[1]) listingId = Number(BigInt("0x" + parts[1]));
            } catch {}
          }

          await pool.query(
            `INSERT INTO tcl_marketplace_events (tx_hash, function, sender, listing_id, timestamp)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tx_hash) DO NOTHING`,
            [tx.txHash, func, sender, listingId, ts]
          );
          indexed++;
          if (func === "cancelListing" && listingId) cancelledIds.push(listingId);
          if (func === "listNFT") hasNewListings = true;
        } catch (e) {
          console.warn("Event index error:", e.message);
        }
      }

      from += txs.length;
      if (txs.length < pageSize || newTxs.length < txs.length) break;
    }

    if (cancelledIds.length > 0) {
      await pool.query(
        "UPDATE tcl_marketplace_listings SET is_active=false WHERE listing_id = ANY($1)",
        [cancelledIds]
      );
      console.log(`Events sync: cancelled ${cancelledIds.length} listings immediately`);
    }
    if (hasNewListings) {
      syncActiveListings().catch(e => console.warn("listings re-sync after listNFT:", e.message));
    }
    if (indexed > 0) console.log(`Events sync: indexed ${indexed} new events`);
  } catch (e) {
    console.warn("syncMarketplaceEvents error:", e.message);
  } finally {
    _eventsSyncRunning = false;
  }
}

// ── Sync active listings from contract ────────────────────────────────────
let _listingSyncRunning = false;
async function syncActiveListings() {
  if (_listingSyncRunning) return;
  _listingSyncRunning = true;
  try {
    // 1. Get active listing IDs
    const qData = await fetchMarketplaceSource("sc-query", { scAddress: MARKETPLACE_SC, funcName: "getActiveListings" });
    const returnData = qData?.data?.data?.returnData || qData?.returnData || [];
    const activeIds = returnData
      .map(b64 => { try { const buf = Buffer.from(b64, "base64"); if (!buf.length) return null; let n = 0n; for (const byte of buf) n = (n << 8n) | BigInt(byte); return Number(n); } catch { return null; } })
      .filter(id => id && id > 0);

    const client = await pool.connect();
    try {
      // 2. Deactivate listings no longer on contract
      if (activeIds.length > 0) {
        await client.query(
          "UPDATE tcl_marketplace_listings SET is_active=false WHERE is_active=true AND NOT (listing_id = ANY($1))",
          [activeIds]
        );
      } else {
        await client.query("UPDATE tcl_marketplace_listings SET is_active=false WHERE is_active=true");
      }

      // 3. Find which IDs are new
      const { rows: existing } = await client.query(
        "SELECT listing_id FROM tcl_marketplace_listings WHERE listing_id = ANY($1)",
        [activeIds]
      );
      const existingSet = new Set(existing.map(r => Number(r.listing_id)));
      const newIds = activeIds.filter(id => !existingSet.has(id));

      // 4. Fetch + store new listings
      for (const id of newIds) {
        try {
          const d = await fetchMarketplaceSource("sc-query", { scAddress: MARKETPLACE_SC, funcName: "getListing", args: id.toString(16).padStart(16, "0") });
          const raw = d?.data?.data?.returnData?.[0] || d?.returnData?.[0];
          if (!raw) continue;
          const l = decodeListingStruct(raw);
          await client.query(`
            INSERT INTO tcl_marketplace_listings
              (listing_id, seller, nft_token, nft_nonce, price, royalty_address, royalty_percent, timestamp_listed, is_active, synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),true,NOW())
            ON CONFLICT (listing_id) DO UPDATE SET
              seller=$2, price=$5, is_active=true, synced_at=NOW()
          `, [l.listing_id, l.seller, l.nft_token, l.nft_nonce, l.price.toString(),
              l.royalty_address, l.royalty_percent, l.timestamp]);
          await new Promise(r => setTimeout(r, 500)); // gentle rate-limit
        } catch (e) {
          console.warn(`Listing ${id} fetch error:`, e.message);
        }
      }
      if (newIds.length > 0 || activeIds.length > 0)
        console.log(`Listings sync: ${activeIds.length} active, ${newIds.length} new`);
    } finally {
      client.release();
    }
  } catch (e) {
    console.warn("syncActiveListings error:", e.message);
  } finally {
    _listingSyncRunning = false;
  }
}

const MARKETPLACE_SOURCE_URL = process.env.MARKETPLACE_SOURCE_URL
  || "https://tcl-event-push.axel4ro.workers.dev/api/marketplace/source";
const MARKETPLACE_SYNC_LOCK = 713240621;
const marketplacePriceCache = new Map();
let marketplaceSyncPromise = null;

async function fetchMarketplaceSource(kind, params = {}) {
  const url = new URL(MARKETPLACE_SOURCE_URL);
  url.searchParams.set("kind", kind);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Marketplace source HTTP ${response.status}: ${text.slice(0, 120)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Marketplace source returned invalid JSON: ${text.slice(0, 120)}`);
  }
}

async function fetchTclPriceUsd() {
  try {
    const d = await fetch("https://api.dexscreener.com/latest/dex/pairs/multiversx/erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff")
      .then(r => r.json());
    return parseFloat(d?.pairs?.[0]?.priceUsd || 0) || 0;
  } catch { return 0; }
}

function decodeBase64Unsigned(value) {
  const hex = Buffer.from(value || "", "base64").toString("hex");
  return hex ? BigInt(`0x${hex}`) : 0n;
}

function decodeBase64Address(value) {
  try {
    const bytes = Buffer.from(value || "", "base64");
    return bytes.length === 32 ? new Address(bytes).toBech32() : null;
  } catch {
    return null;
  }
}

function findListingSoldEvent(events) {
  return (Array.isArray(events) ? events : []).find(event => {
    if (event?.identifier === "listingSold") return true;
    return Buffer.from(event?.topics?.[0] || "", "base64").toString("utf8") === "listingSold";
  });
}

function parseMarketplaceSale(tx) {
  const events = tx?.logs?.events || [];
  const soldEvent = findListingSoldEvent(events);
  const nftEvent = events.find(event =>
    event?.identifier === "ESDTNFTTransfer"
    && event?.address === MARKETPLACE_SC
    && Array.isArray(event?.topics)
  );
  const callData = Buffer.from(tx?.data || "", "base64").toString("utf8").split("@");
  const transfer = tx?.action?.arguments?.transfers?.find(item => item?.token === TCL_TOKEN);

  const listingIdRaw = soldEvent?.topics?.[1]
    ? decodeBase64Unsigned(soldEvent.topics[1])
    : tx?.action?.arguments?.functionArgs?.[0]
      ? BigInt(`0x${tx.action.arguments.functionArgs[0]}`)
      : callData[4]
        ? BigInt(`0x${callData[4]}`)
        : 0n;
  const priceRaw = soldEvent?.data
    ? decodeBase64Unsigned(soldEvent.data)
    : transfer?.value
      ? BigInt(transfer.value)
      : callData[2]
        ? BigInt(`0x${callData[2]}`)
        : 0n;

  return {
    txHash: tx?.txHash || tx?.hash || "",
    listingId: Number(listingIdRaw),
    buyer: decodeBase64Address(soldEvent?.topics?.[2]) || tx?.sender || null,
    nftToken: nftEvent?.topics?.[0]
      ? Buffer.from(nftEvent.topics[0], "base64").toString("utf8")
      : null,
    nftNonce: nftEvent?.topics?.[1]
      ? Number(decodeBase64Unsigned(nftEvent.topics[1]))
      : null,
    price: priceRaw,
    timestamp: Number(tx?.timestamp) || Math.floor(Date.now() / 1000),
  };
}

async function enrichMarketplaceSale(sale) {
  const details = await fetchMarketplaceSource("transaction", { hash: sale.txHash });
  const operations = Array.isArray(details?.operations) ? details.operations : [];

  // Buyer = whoever receives the NFT from the marketplace SC
  const nftTransfer = operations.find(operation =>
    operation?.type === "nft"
    && operation?.sender === MARKETPLACE_SC
  );
  const buyer = nftTransfer?.receiver || sale.buyer;

  // Seller = largest TCL transfer from SC to someone who is NOT the buyer
  const sellerTransfer = operations
    .filter(operation =>
      operation?.action === "transfer"
      && operation?.type === "esdt"
      && operation?.identifier === TCL_TOKEN
      && operation?.sender === MARKETPLACE_SC
      && operation?.receiver !== buyer
    )
    .sort((left, right) => {
      const leftValue = BigInt(left?.value || "0");
      const rightValue = BigInt(right?.value || "0");
      return leftValue === rightValue ? 0 : leftValue > rightValue ? -1 : 1;
    })[0];

  return {
    ...sale,
    buyer,
    seller: sellerTransfer?.receiver || null,
    nftToken: sale.nftToken || nftTransfer?.collection || null,
    nftNonce: sale.nftNonce ?? (
      nftTransfer?.identifier?.includes("-")
        ? Number.parseInt(nftTransfer.identifier.split("-").at(-1), 16)
        : null
    ),
  };
}

async function fetchTclPriceAt(timestamp) {
  const cacheKey = Math.floor(timestamp / 300);
  if (marketplacePriceCache.has(cacheKey)) return marketplacePriceCache.get(cacheKey);

  const transfers = await fetchMarketplaceSource("pair", {
    before: timestamp + 1,
    size: 200,
  });
  const pair = {
    pairAddress: VOLUME_CONFIG.pairAddress,
    baseToken: { address: VOLUME_CONFIG.baseTokenAddress },
    quoteToken: { address: VOLUME_CONFIG.quoteTokenAddress },
  };
  const trade = parseVolumeTrades(transfers, pair)
    .filter(item => item.timestamp <= timestamp)
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  const result = trade
    ? { price: trade.price, timestamp: trade.timestamp, source: "xexchange-nearest-swap" }
    : { price: null, timestamp: null, source: "unavailable" };
  marketplacePriceCache.set(cacheKey, result);
  return result;
}

async function performMarketplaceSync() {
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lockResult = await lockClient.query(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [MARKETPLACE_SYNC_LOCK]
    );
    locked = Boolean(lockResult.rows[0]?.locked);
    if (!locked) return 0;

    let from = 0;
    let indexed = 0;
    const pageSize = 50;

    while (true) {
      const txs = await fetchMarketplaceSource("sales", { from, size: pageSize });
      if (!Array.isArray(txs) || !txs.length) break;

      const hashes = txs.map(tx => tx?.txHash || tx?.hash).filter(Boolean);
      const { rows: completeRows } = hashes.length
        ? await lockClient.query(
            `SELECT tx_hash
             FROM tcl_marketplace_sales
             WHERE tx_hash = ANY($1::text[])
               AND price_usd IS NOT NULL
               AND seller IS NOT NULL
               AND nft_token IS NOT NULL`,
            [hashes]
          )
        : { rows: [] };
      const completeHashes = new Set(completeRows.map(row => row.tx_hash));
      const pending = txs.filter(tx => !completeHashes.has(tx?.txHash || tx?.hash));
      if (!pending.length) break;

      for (const tx of pending) {
        try {
          let sale = parseMarketplaceSale(tx);
          if (!sale.txHash || !sale.listingId || sale.price <= 0n) continue;
          sale = await enrichMarketplaceSale(sale);
          const valuation = await fetchTclPriceAt(sale.timestamp);
          const priceTcl = decimalStringToNumber(sale.price.toString(), 18);
          const priceUsd = valuation.price ? priceTcl * valuation.price : null;

          await lockClient.query(`
            INSERT INTO tcl_marketplace_sales
              (listing_id, seller, buyer, nft_token, nft_nonce, price, price_usd,
               tcl_price_usd, price_source, price_timestamp, tx_hash, sold_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (tx_hash) DO UPDATE SET
              listing_id = EXCLUDED.listing_id,
              seller = COALESCE(EXCLUDED.seller, tcl_marketplace_sales.seller),
              buyer = COALESCE(EXCLUDED.buyer, tcl_marketplace_sales.buyer),
              nft_token = COALESCE(EXCLUDED.nft_token, tcl_marketplace_sales.nft_token),
              nft_nonce = COALESCE(EXCLUDED.nft_nonce, tcl_marketplace_sales.nft_nonce),
              price = EXCLUDED.price,
              price_usd = COALESCE(EXCLUDED.price_usd, tcl_marketplace_sales.price_usd),
              tcl_price_usd = COALESCE(EXCLUDED.tcl_price_usd, tcl_marketplace_sales.tcl_price_usd),
              price_source = EXCLUDED.price_source,
              price_timestamp = COALESCE(EXCLUDED.price_timestamp, tcl_marketplace_sales.price_timestamp),
              sold_at = EXCLUDED.sold_at
          `, [
            sale.listingId,
            sale.seller,
            sale.buyer,
            sale.nftToken,
            sale.nftNonce,
            sale.price.toString(),
            priceUsd,
            valuation.price,
            valuation.source,
            valuation.timestamp ? new Date(valuation.timestamp * 1000) : null,
            sale.txHash,
            new Date(sale.timestamp * 1000),
          ]);
          indexed++;
        } catch (error) {
          console.warn(`Marketplace sale skipped: ${error?.message || error}`);
        }
      }

      from += txs.length;
      if (txs.length < pageSize) break;
    }

    if (indexed > 0) console.log(`Marketplace sync: indexed ${indexed} sales`);
    return indexed;
  } finally {
    if (locked) {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [MARKETPLACE_SYNC_LOCK]).catch(() => {});
    }
    lockClient.release();
  }
}

function runMarketplaceSync() {
  if (!marketplaceSyncPromise) {
    marketplaceSyncPromise = performMarketplaceSync()
      .finally(() => { marketplaceSyncPromise = null; });
  }
  return marketplaceSyncPromise;
}


// GET /api/marketplace/wallet-nfts/:address — NFTs in wallet enriched with storage from DB
// MVX /collections/{col}/nfts does not reliably return owner field;
// fetch from /accounts/{addr}/nfts and merge sc_* storage fields from DB by identifier.
app.get("/api/marketplace/wallet-nfts/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!address.startsWith("erd1") || address.length < 60)
      return res.status(400).json({ error: "Invalid address" });

    const TCL_CREATORS_SET = new Set([
      "erd1tpayjteeg67rq7me94k36705dh2c077xjsmhzdmkkwjeg0w00ufsmmltyc",
      "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk",
    ]);

    // 1. Use gateway to get live wallet ESDs (gateway is not rate-limited unlike api.multiversx.com)
    const gwResp = await fetch(`${MVX_GATEWAY}/address/${address}/esdt`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!gwResp.ok) return res.json({ nfts: [] });
    const gwData = await gwResp.json();
    const esdts = gwData?.data?.esdts || {};
    // Filter for TCL NFTs: identifier starts with "TCL", has a dash-nonce suffix, not the fungible token
    const tclIds = Object.keys(esdts).filter(k =>
      k.startsWith("TCL") && k !== TCL_TOKEN && /^TCL[A-Z]+-[0-9a-f]+-[0-9a-f]+$/i.test(k)
    );
    if (!tclIds.length) return res.json({ nfts: [] });

    // 2. Get full NFT data from our DB (metadata, SC attributes, media)
    const { rows: dbRows } = await pool.query(
      `SELECT identifier, collection, nonce, name, image_url, metadata, royalties, creator,
              sc_quality, sc_wave, sc_has_bonus, sc_has_crystal,
              sc_socket_count, sc_tcl_count, sc_tcl_max, sc_refinement_ts
       FROM tcl_nfts WHERE identifier = ANY($1) ORDER BY collection, nonce`,
      [tclIds]
    );
    const dbMap = {};
    for (const row of dbRows) dbMap[row.identifier] = row;

    // Build NFT objects: DB data + media formatted for frontend
    const nfts = tclIds.map(id => {
      const row = dbMap[id];
      if (!row) return null;
      return {
        identifier: row.identifier,
        collection: row.collection,
        nonce: row.nonce,
        name: row.name,
        media: row.image_url ? [{ url: row.image_url }] : [],
        royalties: row.royalties,
        creator: row.creator,
        sc_quality: row.sc_quality,
        sc_wave: row.sc_wave,
        sc_has_bonus: row.sc_has_bonus,
        sc_has_crystal: row.sc_has_crystal,
        sc_socket_count: row.sc_socket_count,
        sc_tcl_count: row.sc_tcl_count,
        sc_tcl_max: row.sc_tcl_max,
        sc_refinement_ts: row.sc_refinement_ts,
      };
    }).filter(Boolean);

    res.setHeader("Cache-Control", "no-cache");
    res.json({ nfts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/marketplace/wallet-nfts/:address/invalidate — cache bust (no-op, data always fresh)
app.post("/api/marketplace/wallet-nfts/:address/invalidate", (req, res) => {
  res.json({ ok: true });
});

// GET /api/marketplace/active-listings — serve from DB (synced from contract every 5 min)
app.get("/api/marketplace/active-listings", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.listing_id, l.seller, l.nft_token, l.nft_nonce,
             l.price::text AS price, l.royalty_address, l.royalty_percent,
             EXTRACT(EPOCH FROM l.timestamp_listed)::bigint AS timestamp,
             n.name AS nft_name, n.image_url, n.metadata, n.creator, n.royalties,
             n.sc_quality, n.sc_wave, n.sc_has_bonus, n.sc_has_crystal,
             n.sc_socket_count, n.sc_tcl_count::text AS sc_tcl_count,
             n.sc_tcl_max::text AS sc_tcl_max, n.sc_refinement_ts
      FROM tcl_marketplace_listings l
      LEFT JOIN tcl_nfts n ON n.collection = l.nft_token AND n.nonce = l.nft_nonce
      WHERE l.is_active = true
      ORDER BY l.timestamp_listed DESC
    `);
    const listings = rows.map(l => ({
      listing_id: Number(l.listing_id),
      seller:     l.seller,
      nft_token:  l.nft_token,
      nft_nonce:  Number(l.nft_nonce),
      price:      l.price,
      royalty_address: l.royalty_address,
      royalty_percent: Number(l.royalty_percent),
      timestamp:  Number(l.timestamp),
      is_active:  true,
      nft: l.nft_name ? {
        identifier: `${l.nft_token}-${nonceToHex(l.nft_nonce)}`,
        collection: l.nft_token,
        nonce:      Number(l.nft_nonce),
        name:       l.nft_name,
        media:      l.image_url ? [{ url: l.image_url }] : [],
        image_url:  l.image_url,
        metadata:   l.metadata,
        creator:    l.creator,
        royalties:  l.royalties,
        sc_quality:       l.sc_quality,
        sc_wave:          l.sc_wave,
        sc_has_bonus:     l.sc_has_bonus,
        sc_has_crystal:   l.sc_has_crystal,
        sc_socket_count:  l.sc_socket_count,
        sc_tcl_count:     l.sc_tcl_count,
        sc_tcl_max:       l.sc_tcl_max,
        sc_refinement_ts: l.sc_refinement_ts,
      } : null,
    }));
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ listings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/marketplace/latest-tx — latest event hash from DB (used by frontend instead of direct MVX call)
app.get("/api/marketplace/latest-tx", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT tx_hash FROM tcl_marketplace_events ORDER BY timestamp DESC LIMIT 1"
    );
    res.setHeader("Cache-Control", "public, max-age=10");
    res.json({ txHash: rows[0]?.tx_hash || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/marketplace/sales — recent sales from DB
app.get("/api/marketplace/sales", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const { rows } = await pool.query(
      `SELECT s.*, n.name AS nft_name, n.image_url
       FROM tcl_marketplace_sales s
       LEFT JOIN tcl_nfts n ON n.collection = s.nft_token AND n.nonce = s.nft_nonce
       ORDER BY s.sold_at DESC LIMIT $1`,
      [limit]
    );
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/marketplace/reenrich — re-fetch buyer/seller for rows where buyer == seller
app.post("/api/marketplace/reenrich", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tx_hash FROM tcl_marketplace_sales WHERE buyer = seller OR buyer IS NULL OR seller IS NULL LIMIT 200`
    );
    if (rows.length === 0) return res.json({ fixed: 0 });
    let fixed = 0;
    for (const { tx_hash } of rows) {
      try {
        const base = { txHash: tx_hash, buyer: null, nftToken: null, nftNonce: null, price: 0n, timestamp: 0 };
        const enriched = await enrichMarketplaceSale(base);
        if (enriched.buyer && enriched.seller && enriched.buyer !== enriched.seller) {
          await pool.query(
            `UPDATE tcl_marketplace_sales SET buyer = $1, seller = $2 WHERE tx_hash = $3`,
            [enriched.buyer, enriched.seller, tx_hash]
          );
          fixed++;
        }
      } catch {}
    }
    res.json({ fixed, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/marketplace/stats — volume, floor, total sales
app.get("/api/marketplace/stats", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int                                                   AS total_sales,
        COUNT(price_usd)::int                                           AS valued_sales,
        COALESCE(SUM(price::numeric) / 1e18, 0)                        AS volume_tcl,
        COALESCE(SUM(price_usd), 0)                                     AS volume_usd,
        COALESCE(MIN(price::numeric) / 1e18, 0)                        AS floor_price_tcl,
        COALESCE(MAX(price::numeric) / 1e18, 0)                        AS max_price_tcl
      FROM tcl_marketplace_sales
    `);
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/marketplace/wallet/:address — EGLD + TCL balances with USD
app.get("/api/marketplace/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!address.startsWith("erd1") || address.length < 60)
      return res.status(400).json({ error: "Invalid address" });

    const [walletData, tclUsd] = await Promise.all([
      fetchMarketplaceSource("wallet", { address }),
      fetchTclPriceUsd(),
    ]);
    const accountData = walletData?.account;
    const tokenData = walletData?.token;
    const egldData = walletData?.economics;

    const egldRaw    = BigInt(accountData?.balance || "0");
    const egldAmount = Number(egldRaw) / 1e18;
    const egldUsd    = parseFloat(egldData?.price || 0) || 0;

    const tclRaw    = BigInt(tokenData?.balance || "0");
    const tclAmount = Number(tclRaw) / 1e18;

    res.setHeader("Cache-Control", "public, max-age=20");
    res.json({
      egld:     egldAmount,
      egld_usd: egldAmount * egldUsd,
      tcl:      tclAmount,
      tcl_usd:  tclAmount * tclUsd,
      egld_price: egldUsd,
      tcl_price:  tclUsd,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/marketplace/sync — manual trigger (admin)
app.post("/api/marketplace/sync", async (req, res) => {
  const secret = req.headers["x-admin-secret"] || "";
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET)
    return res.status(401).json({ error: "Unauthorized" });
  res.json({ ok: true, message: "Marketplace sync started" });
  runMarketplaceSync().catch(e => console.error("Marketplace sync error:", e.message));
});

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

// ── DB Migration — add SC attribute columns if missing ────────────────────────
async function runMigrations() {
  const migrations = [
    `ALTER TABLE tcl_nfts ADD COLUMN IF NOT EXISTS sc_quality       INT`,
    `ALTER TABLE tcl_nfts ADD COLUMN IF NOT EXISTS sc_wave          INT`,
    `ALTER TABLE tcl_nfts ADD COLUMN IF NOT EXISTS sc_has_bonus     BOOLEAN`,
    `ALTER TABLE tcl_nfts ADD COLUMN IF NOT EXISTS sc_has_crystal   BOOLEAN`,
    `ALTER TABLE tcl_nfts ADD COLUMN IF NOT EXISTS sc_socket_count  INT`,
    `ALTER TABLE tcl_nfts ADD COLUMN IF NOT EXISTS sc_tcl_count     NUMERIC(36,0)`,
    `ALTER TABLE tcl_nfts ADD COLUMN IF NOT EXISTS sc_tcl_max       NUMERIC(36,0)`,
    `ALTER TABLE tcl_nfts ADD COLUMN IF NOT EXISTS sc_refinement_ts BIGINT`,
    `CREATE TABLE IF NOT EXISTS tcl_marketplace_sales (
       id            BIGSERIAL PRIMARY KEY,
       listing_id    BIGINT NOT NULL,
       seller        TEXT,
       buyer         TEXT,
       nft_token     TEXT,
       nft_nonce     BIGINT,
       price         NUMERIC(36,0),
       price_usd     NUMERIC(24,8),
       tcl_price_usd NUMERIC(24,12),
       price_source  TEXT,
       price_timestamp TIMESTAMPTZ,
       royalty_pct   INT,
       tx_hash       TEXT UNIQUE,
       sold_at       TIMESTAMPTZ DEFAULT NOW()
     )`,
    `ALTER TABLE tcl_marketplace_sales ADD COLUMN IF NOT EXISTS price_usd NUMERIC(24,8)`,
    `ALTER TABLE tcl_marketplace_sales ADD COLUMN IF NOT EXISTS tcl_price_usd NUMERIC(24,12)`,
    `ALTER TABLE tcl_marketplace_sales ADD COLUMN IF NOT EXISTS price_source TEXT`,
    `ALTER TABLE tcl_marketplace_sales ADD COLUMN IF NOT EXISTS price_timestamp TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_mp_sales_nft ON tcl_marketplace_sales(nft_token, nft_nonce)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_sales_seller ON tcl_marketplace_sales(seller)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_sales_buyer ON tcl_marketplace_sales(buyer)`,
    `CREATE TABLE IF NOT EXISTS tcl_marketplace_listings (
       listing_id       BIGINT PRIMARY KEY,
       seller           TEXT,
       nft_token        TEXT,
       nft_nonce        BIGINT,
       price            NUMERIC(36,0),
       royalty_address  TEXT,
       royalty_percent  INT,
       timestamp_listed TIMESTAMPTZ,
       is_active        BOOLEAN DEFAULT true,
       synced_at        TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_mp_listings_active ON tcl_marketplace_listings(is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_listings_nft ON tcl_marketplace_listings(nft_token, nft_nonce)`,
    `CREATE TABLE IF NOT EXISTS tcl_marketplace_events (
       tx_hash    TEXT PRIMARY KEY,
       function   TEXT NOT NULL,
       sender     TEXT,
       listing_id BIGINT,
       timestamp  TIMESTAMPTZ,
       indexed_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_mp_events_ts ON tcl_marketplace_events(timestamp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_events_fn ON tcl_marketplace_events(function)`,
  ];
  const client = await pool.connect();
  try {
    for (const sql of migrations) {
      try {
        await client.query(sql);
      } catch (error) {
        console.warn(`Migration skipped: ${error.message}`);
      }
    }
    console.log("DB migrations OK");
  } finally {
    client.release();
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
pool.connect().then(async client => {
  client.release();
  await runMigrations();
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`TCL API listening on http://127.0.0.1:${PORT}`);
    runScheduledWheelDraws();
    const wheelDrawTimer = setInterval(runScheduledWheelDraws, WHEEL_DRAW_INTERVAL_MS);
    wheelDrawTimer.unref();
    // Auto-index marketplace sales every 5 minutes
    runMarketplaceSync().catch(e => console.error("Marketplace initial sync:", e.message));
    const mpSyncTimer = setInterval(() => {
      runMarketplaceSync().catch(e => console.error("Marketplace sync:", e.message));
    }, 5 * 60 * 1000);
    mpSyncTimer.unref();
    // Auto-sync active listings from contract every 5 minutes
    syncActiveListings().catch(e => console.error("Listings initial sync:", e.message));
    const listingSyncTimer = setInterval(() => {
      syncActiveListings().catch(e => console.error("Listings sync:", e.message));
    }, 5 * 60 * 1000);
    listingSyncTimer.unref();
    // Sync all SC events every 30s — powers /api/marketplace/latest-tx (eliminates direct MVX calls)
    syncMarketplaceEvents().catch(e => console.error("Events initial sync:", e.message));
    const eventsSyncTimer = setInterval(() => {
      syncMarketplaceEvents().catch(e => console.error("Events sync:", e.message));
    }, 30 * 1000);
    eventsSyncTimer.unref();
  });
}).catch(err => {
  console.error("DB connection failed:", err.message);
  process.exit(1);
});
