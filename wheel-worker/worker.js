// TCL Community Free Monthly Wheel — Cloudflare Worker
// All ticket claims are validated server-side. No payment for entry.

const MVX_API = "https://api.multiversx.com";
const TCL_TOKEN = "TCL-fe459d";
const TCL_DECIMALS = 18;

function isValidWallet(addr) {
  return /^erd1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(String(addr || "").trim());
}

function utcDay() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function utcMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function corsHeaders(origin, allowed) {
  const o = allowed.includes(origin) ? origin : (allowed[0] || "*");
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
    "Access-Control-Max-Age": "86400"
  };
}

async function sb(env, method, path, body = null, extraHeaders = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extraHeaders
  };
  if (method === "POST" || method === "PATCH") {
    headers["Prefer"] = extraHeaders["Prefer"] || "return=representation";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${method} ${path}: ${res.status} — ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("Content-Type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

async function mvxAccount(address) {
  try {
    const res = await fetch(`${MVX_API}/accounts/${address}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

async function mvxTokenBalance(address, token) {
  try {
    const res = await fetch(`${MVX_API}/accounts/${address}/tokens/${token}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

function formatTcl(raw) {
  if (!raw || raw === "0") return "0";
  const s = String(raw).padStart(TCL_DECIMALS + 1, "0");
  const whole = s.slice(0, -TCL_DECIMALS) || "0";
  const frac = s.slice(-TCL_DECIMALS).replace(/0+$/, "").slice(0, 4);
  return frac ? `${whole}.${frac}` : whole;
}

function ticketNumber(month, id) {
  return `TCL-FREE-${month}-${String(id).padStart(6, "0")}`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "https://tclexplorer.com").split(",").map(s => s.trim());
    const ch = corsHeaders(origin, allowed);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: ch });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const ok = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...ch, "Content-Type": "application/json" }
      });
    const fail = (msg, status = 400) => ok({ ok: false, error: msg }, status);

    try {
      // ── GET /config ────────────────────────────────────────────────────────
      if (path === "/config" && request.method === "GET") {
        const rows = await sb(env, "GET",
          "wheel_config?select=wheel_wallet,host_herotag,host_wallet,token_identifier,enabled,prize_split&limit=1");
        return ok({ ok: true, config: rows?.[0] || null, month: utcMonth() });
      }

      // ── GET /pool ──────────────────────────────────────────────────────────
      if (path === "/pool" && request.method === "GET") {
        const rows = await sb(env, "GET", "wheel_config?select=wheel_wallet&limit=1");
        const wallet = rows?.[0]?.wheel_wallet;
        if (!wallet) return ok({ ok: true, balance: "0", formatted: "0", wallet: "" });
        const info = await mvxTokenBalance(wallet, TCL_TOKEN);
        const raw = info?.balance || "0";
        return ok({ ok: true, balance: raw, formatted: formatTcl(raw), decimals: TCL_DECIMALS, wallet });
      }

      // ── POST /eligibility ─────────────────────────────────────────────────
      if (path === "/eligibility" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const wallet = String(body.wallet || "").trim();
        if (!isValidWallet(wallet)) return fail("Invalid wallet address.");

        const cfg = await sb(env, "GET", "wheel_config?select=enabled&limit=1");
        if (!cfg?.[0]?.enabled) return ok({ ok: true, eligible: false, reason: "Wheel is not active this month." });

        const today = utcDay();
        const dup = await sb(env, "GET",
          `wheel_tickets?wallet_address=eq.${encodeURIComponent(wallet)}&ticket_day=eq.${today}&select=ticket_number&limit=1`);
        if (dup?.length > 0) {
          return ok({ ok: true, eligible: false, reason: "Already claimed today.", ticket: dup[0].ticket_number });
        }

        const account = await mvxAccount(wallet);
        const herotag = account?.username || "";
        if (!herotag) {
          return ok({ ok: true, eligible: false, reason: "HeroTag required. Register one at xPortal." });
        }

        return ok({ ok: true, eligible: true, herotag });
      }

      // ── POST /claim ────────────────────────────────────────────────────────
      if (path === "/claim" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const wallet = String(body.wallet || "").trim();
        if (!isValidWallet(wallet)) return fail("Invalid wallet address.");

        const cfg = await sb(env, "GET", "wheel_config?select=enabled&limit=1");
        if (!cfg?.[0]?.enabled) return fail("Wheel is not active this month.", 403);

        const account = await mvxAccount(wallet);
        const herotag = account?.username || "";
        if (!herotag) return fail("HeroTag required. Register one at xPortal.", 403);

        const today = utcDay();
        const month = today.slice(0, 7);

        // Idempotent: already claimed today
        const dup = await sb(env, "GET",
          `wheel_tickets?wallet_address=eq.${encodeURIComponent(wallet)}&ticket_day=eq.${today}&select=id,ticket_number&limit=1`);
        if (dup?.length > 0) {
          return ok({ ok: true, already: true, ticket: dup[0].ticket_number, herotag, day: today, month });
        }

        // Insert with placeholder ticket_number (unique constraint satisfied by id suffix)
        const inserted = await sb(env, "POST", "wheel_tickets", {
          raffle_month: month,
          wallet_address: wallet,
          herotag,
          ticket_day: today,
          ticket_number: `TCL-FREE-${month}-PENDING-${Date.now()}`,
          status: "valid"
        });

        const row = Array.isArray(inserted) ? inserted[0] : inserted;
        if (!row?.id) return fail("Ticket creation failed. Please try again.", 500);

        const tn = ticketNumber(month, row.id);
        await sb(env, "PATCH",
          `wheel_tickets?id=eq.${row.id}`,
          { ticket_number: tn },
          { Prefer: "return=minimal" });

        await sb(env, "POST", "wheel_audit_logs", {
          action: "claim_ticket",
          wallet_address: wallet,
          data: { ticket_number: tn, herotag, ticket_day: today, month }
        }, { Prefer: "return=minimal" }).catch(() => {});

        return ok({ ok: true, ticket: tn, herotag, wallet, day: today, month });
      }

      // ── GET /tickets ───────────────────────────────────────────────────────
      if (path === "/tickets" && request.method === "GET") {
        const wallet = url.searchParams.get("wallet") || "";
        if (!isValidWallet(wallet)) return fail("Invalid wallet address.");
        const month = url.searchParams.get("month") || utcMonth();
        const tickets = await sb(env, "GET",
          `wheel_tickets?wallet_address=eq.${encodeURIComponent(wallet)}&raffle_month=eq.${month}&select=ticket_number,ticket_day,status&order=id.asc`);
        return ok({ ok: true, tickets: tickets || [], month });
      }

      // ── GET /contributors ─────────────────────────────────────────────────
      if (path === "/contributors" && request.method === "GET") {
        const month = url.searchParams.get("month") || utcMonth();
        const contributors = await sb(env, "GET",
          `wheel_contributions?raffle_month=eq.${month}&select=herotag,wallet_address,amount_tcl,created_at&order=amount_tcl.desc&limit=50`);
        return ok({ ok: true, contributors: contributors || [], month });
      }

      // ── GET /winners ───────────────────────────────────────────────────────
      if (path === "/winners" && request.method === "GET") {
        const month = url.searchParams.get("month") || utcMonth();
        const winners = await sb(env, "GET",
          `wheel_winners?raffle_month=eq.${month}&select=place,herotag,wallet_address,ticket_number,reward_tcl,paid_status&order=place.asc`);
        return ok({ ok: true, winners: winners || [], month });
      }

      // ── Admin: auth check ──────────────────────────────────────────────────
      if (path.startsWith("/admin/")) {
        const adminSecret = request.headers.get("X-Admin-Secret") || "";
        if (!adminSecret || adminSecret !== env.ADMIN_SECRET) {
          return fail("Unauthorized.", 401);
        }

        // POST /admin/draw
        if (path === "/admin/draw" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const month = String(body.month || utcMonth()).trim();

          const existing = await sb(env, "GET",
            `wheel_winners?raffle_month=eq.${month}&select=id&limit=1`);
          if (existing?.length > 0) return fail(`Winners already drawn for ${month}.`, 409);

          const tickets = await sb(env, "GET",
            `wheel_tickets?raffle_month=eq.${month}&status=eq.valid&select=id,ticket_number,wallet_address,herotag`);
          if (!tickets?.length || tickets.length < 3) {
            return fail(`Not enough tickets (${tickets?.length || 0}). Need at least 3.`, 400);
          }

          const cfgRows = await sb(env, "GET", "wheel_config?select=wheel_wallet,prize_split&limit=1");
          const cfg = cfgRows?.[0] || {};
          const tokenInfo = await mvxTokenBalance(cfg.wheel_wallet, TCL_TOKEN);
          const poolRaw = BigInt(tokenInfo?.balance || "0");

          const split = cfg.prize_split || { first: 50, second: 30, third: 20 };
          const rewards = [
            (poolRaw * BigInt(split.first)) / 100n,
            (poolRaw * BigInt(split.second)) / 100n,
            (poolRaw * BigInt(split.third)) / 100n
          ];

          // Crypto-random draw — 3 unique tickets
          const pool = [...tickets];
          const chosen = [];
          for (let i = 0; i < 3; i++) {
            const rnd = new Uint32Array(1);
            crypto.getRandomValues(rnd);
            const idx = rnd[0] % pool.length;
            chosen.push(pool.splice(idx, 1)[0]);
          }

          for (let i = 0; i < 3; i++) {
            await sb(env, "POST", "wheel_winners", {
              raffle_month: month,
              place: i + 1,
              ticket_id: chosen[i].id,
              ticket_number: chosen[i].ticket_number,
              wallet_address: chosen[i].wallet_address,
              herotag: chosen[i].herotag,
              reward_tcl: rewards[i].toString(),
              paid_status: "unpaid"
            }, { Prefer: "return=minimal" });
          }

          await sb(env, "POST", "wheel_audit_logs", {
            action: "draw_winners",
            wallet_address: null,
            data: { month, total_tickets: tickets.length, chosen: chosen.map(t => t.ticket_number) }
          }, { Prefer: "return=minimal" }).catch(() => {});

          return ok({
            ok: true, month,
            winners: chosen.map((t, i) => ({
              place: i + 1,
              ticket: t.ticket_number,
              wallet: t.wallet_address,
              herotag: t.herotag,
              reward_tcl: formatTcl(rewards[i].toString())
            }))
          });
        }

        // POST /admin/mark-paid
        if (path === "/admin/mark-paid" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const { month, place, tx_hash } = body;
          if (!month || !place) return fail("month and place required.");
          await sb(env, "PATCH",
            `wheel_winners?raffle_month=eq.${month}&place=eq.${place}`,
            { paid_status: "paid", paid_tx_hash: tx_hash || null },
            { Prefer: "return=minimal" });
          return ok({ ok: true });
        }

        // POST /admin/update-config
        if (path === "/admin/update-config" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const patch = { updated_at: new Date().toISOString() };
          if (body.wheel_wallet !== undefined) patch.wheel_wallet = body.wheel_wallet;
          if (body.host_herotag !== undefined) patch.host_herotag = body.host_herotag;
          if (body.host_wallet !== undefined) patch.host_wallet = body.host_wallet;
          if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
          await sb(env, "PATCH", "wheel_config?id=gte.1", patch, { Prefer: "return=minimal" });
          return ok({ ok: true });
        }

        // GET /admin/tickets
        if (path === "/admin/tickets" && request.method === "GET") {
          const month = url.searchParams.get("month") || utcMonth();
          const tickets = await sb(env, "GET",
            `wheel_tickets?raffle_month=eq.${month}&select=ticket_number,wallet_address,herotag,ticket_day,status&order=id.asc`);
          return ok({ ok: true, tickets: tickets || [], month });
        }

        // POST /admin/add-contribution (manual log of a donation tx)
        if (path === "/admin/add-contribution" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const { wallet, herotag, amount_tcl, tx_hash, month } = body;
          if (!wallet || !tx_hash || !amount_tcl) return fail("wallet, tx_hash, amount_tcl required.");
          await sb(env, "POST", "wheel_contributions", {
            raffle_month: month || utcMonth(),
            wallet_address: wallet,
            herotag: herotag || "",
            tx_hash,
            amount_tcl: String(amount_tcl)
          }, { Prefer: "return=minimal" });
          return ok({ ok: true });
        }

        return fail("Not found.", 404);
      }

      return fail("Not found.", 404);

    } catch (e) {
      console.error("Wheel worker error:", e);
      return fail("Server error. Please try again.", 500);
    }
  }
};
