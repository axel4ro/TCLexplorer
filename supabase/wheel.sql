-- TCL Community Free Monthly Wheel — Supabase schema
-- Run this in the Supabase SQL editor.

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wheel_config (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  wheel_wallet    TEXT NOT NULL DEFAULT '',
  host_herotag    TEXT NOT NULL DEFAULT '',
  host_wallet     TEXT NOT NULL DEFAULT '',
  token_identifier TEXT NOT NULL DEFAULT 'TCL-fe459d',
  enabled         BOOLEAN NOT NULL DEFAULT false,
  prize_split     JSONB NOT NULL DEFAULT '{"first":50,"second":30,"third":20}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wheel_tickets (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ticket_number  TEXT NOT NULL,
  raffle_month   TEXT NOT NULL,          -- YYYY-MM
  wallet_address TEXT NOT NULL,
  herotag        TEXT NOT NULL DEFAULT '',
  ticket_day     DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'valid',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_number),
  UNIQUE (wallet_address, ticket_day)    -- 1 free ticket per wallet per UTC day
);

CREATE TABLE IF NOT EXISTS wheel_contributions (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  raffle_month   TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  herotag        TEXT NOT NULL DEFAULT '',
  tx_hash        TEXT NOT NULL,
  amount_tcl     TEXT NOT NULL DEFAULT '0',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash)
);

CREATE TABLE IF NOT EXISTS wheel_winners (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  raffle_month   TEXT NOT NULL,
  place          INTEGER NOT NULL CHECK (place BETWEEN 1 AND 3),
  ticket_id      BIGINT REFERENCES wheel_tickets(id),
  ticket_number  TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  herotag        TEXT NOT NULL DEFAULT '',
  reward_tcl     TEXT NOT NULL DEFAULT '0',   -- raw 18-decimal string
  paid_status    TEXT NOT NULL DEFAULT 'unpaid',
  paid_tx_hash   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raffle_month, place)
);

CREATE TABLE IF NOT EXISTS wheel_audit_logs (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  action         TEXT NOT NULL,
  wallet_address TEXT,
  data           JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_wt_month   ON wheel_tickets(raffle_month);
CREATE INDEX IF NOT EXISTS idx_wt_wallet  ON wheel_tickets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wt_day     ON wheel_tickets(ticket_day);
CREATE INDEX IF NOT EXISTS idx_wc_month   ON wheel_contributions(raffle_month);
CREATE INDEX IF NOT EXISTS idx_ww_month   ON wheel_winners(raffle_month);
CREATE INDEX IF NOT EXISTS idx_wal_action ON wheel_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_wal_ts     ON wheel_audit_logs(created_at);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- The Cloudflare Worker uses the service_role key, which bypasses RLS.
-- Anon/public gets read-only access to non-sensitive tables.

ALTER TABLE wheel_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wheel_tickets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wheel_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wheel_winners      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wheel_audit_logs   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_config"         ON wheel_config        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_tickets"        ON wheel_tickets       FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_contributions"  ON wheel_contributions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_winners"        ON wheel_winners       FOR SELECT TO anon USING (true);
-- audit_logs: no anon access

-- ── Seed: one config row ──────────────────────────────────────────────────────
-- Set wheel_wallet, host_herotag, host_wallet, and enabled=true via the admin
-- panel or directly here before going live.

INSERT INTO wheel_config (wheel_wallet, host_herotag, host_wallet, enabled)
VALUES ('', 'TCLexplorer', '', false)
ON CONFLICT DO NOTHING;
