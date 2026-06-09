-- Free Monthly Giveaway compliance and automation migration.
-- Apply before deploying the matching server-api/server.js version.

BEGIN;

CREATE TABLE IF NOT EXISTS public.wheel_campaigns (
  month                TEXT PRIMARY KEY CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  title                TEXT NOT NULL DEFAULT 'TCL Explorer Free Monthly Giveaway',
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'open', 'closed', 'drawn', 'cancelled')),
  starts_at            TIMESTAMPTZ NOT NULL,
  closes_at            TIMESTAMPTZ NOT NULL,
  draw_at              TIMESTAMPTZ NOT NULL,
  min_age              INTEGER NOT NULL DEFAULT 18 CHECK (min_age >= 18),
  eligible_countries   TEXT[] NOT NULL DEFAULT ARRAY['RO']::TEXT[],
  rules_version        TEXT NOT NULL,
  rules_url            TEXT NOT NULL,
  privacy_url          TEXT NOT NULL,
  rules_hash           TEXT NOT NULL CHECK (rules_hash ~ '^[0-9a-f]{64}$'),
  organizer_name       TEXT NOT NULL,
  organizer_address    TEXT NOT NULL,
  organizer_email      TEXT NOT NULL,
  prize_amounts        JSONB NOT NULL,
  prize_arv_ron        JSONB NOT NULL,
  automatic_draw       BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (starts_at < closes_at),
  CHECK (closes_at <= draw_at)
);

ALTER TABLE public.wheel_tickets
  ADD COLUMN IF NOT EXISTS rules_version TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS age_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entry_message TEXT,
  ADD COLUMN IF NOT EXISTS entry_signature TEXT;

ALTER TABLE public.wheel_winners
  ADD COLUMN IF NOT EXISTS draw_proof JSONB;

CREATE INDEX IF NOT EXISTS idx_wheel_campaigns_draw
  ON public.wheel_campaigns (status, automatic_draw, draw_at);

CREATE INDEX IF NOT EXISTS idx_wheel_tickets_acceptance
  ON public.wheel_tickets (raffle_month, rules_version, country_code);

COMMIT;
