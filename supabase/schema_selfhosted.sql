-- =====================================================================
-- TCL Complete Schema — self-hosted PostgreSQL
-- =====================================================================

SET search_path TO public;

-- ─── 1. TCL Transfers ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tcl_transfers (
  tx_hash          TEXT PRIMARY KEY,
  original_tx_hash TEXT,
  type             TEXT,
  sender           TEXT NOT NULL,
  receiver         TEXT NOT NULL,
  ts               INTEGER NOT NULL,
  function         TEXT,
  status           TEXT DEFAULT 'success',
  action_transfers JSONB,
  operations       JSONB,
  enriched         BOOLEAN NOT NULL DEFAULT true,
  synced_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tcl_transfers_sender_ts ON public.tcl_transfers (sender, ts DESC);
CREATE INDEX IF NOT EXISTS tcl_transfers_receiver_ts ON public.tcl_transfers (receiver, ts DESC);
CREATE INDEX IF NOT EXISTS tcl_transfers_ts ON public.tcl_transfers (ts DESC);
CREATE INDEX IF NOT EXISTS tcl_transfers_orig ON public.tcl_transfers (original_tx_hash) WHERE original_tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS tcl_transfers_receiver_sender ON public.tcl_transfers (receiver, sender);
CREATE INDEX IF NOT EXISTS tcl_transfers_sender_receiver ON public.tcl_transfers (sender, receiver);
CREATE INDEX IF NOT EXISTS tcl_transfers_need_enrich ON public.tcl_transfers (ts DESC) WHERE enriched = false;

-- ─── 2. TCL Trades ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tcl_trades (
  tx_hash     TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  wallet      TEXT NOT NULL,
  side        TEXT NOT NULL,
  tcl_amount  NUMERIC NOT NULL,
  usdc_amount NUMERIC NOT NULL,
  price       NUMERIC NOT NULL,
  source      TEXT,
  synced_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tcl_trades_wallet_ts ON public.tcl_trades (wallet, ts DESC);
CREATE INDEX IF NOT EXISTS tcl_trades_ts ON public.tcl_trades (ts DESC);

-- ─── 3. Sync state ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tcl_sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ─── 4. Wheel tables ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wheel_config (
  id               BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  wheel_wallet     TEXT NOT NULL DEFAULT '',
  host_herotag     TEXT NOT NULL DEFAULT '',
  host_wallet      TEXT NOT NULL DEFAULT '',
  token_identifier TEXT NOT NULL DEFAULT 'TCL-fe459d',
  enabled          BOOLEAN NOT NULL DEFAULT false,
  prize_split      JSONB NOT NULL DEFAULT '{"first":50,"second":30,"third":20}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wheel_tickets (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ticket_number  TEXT NOT NULL,
  raffle_month   TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  herotag        TEXT NOT NULL DEFAULT '',
  ticket_day     DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'valid',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_number),
  UNIQUE (wallet_address, ticket_day)
);

CREATE TABLE IF NOT EXISTS public.wheel_contributions (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  raffle_month   TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  herotag        TEXT NOT NULL DEFAULT '',
  tx_hash        TEXT NOT NULL,
  amount_tcl     TEXT NOT NULL DEFAULT '0',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash)
);

CREATE TABLE IF NOT EXISTS public.wheel_winners (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  raffle_month   TEXT NOT NULL,
  place          INTEGER NOT NULL CHECK (place BETWEEN 1 AND 3),
  ticket_id      BIGINT REFERENCES wheel_tickets(id),
  ticket_number  TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  herotag        TEXT NOT NULL DEFAULT '',
  reward_tcl     TEXT NOT NULL DEFAULT '0',
  paid_status    TEXT NOT NULL DEFAULT 'unpaid',
  paid_tx_hash   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raffle_month, place)
);

CREATE TABLE IF NOT EXISTS public.wheel_audit_logs (
  id             BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  action         TEXT NOT NULL,
  wallet_address TEXT,
  data           JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wt_month   ON wheel_tickets(raffle_month);
CREATE INDEX IF NOT EXISTS idx_wt_wallet  ON wheel_tickets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wt_day     ON wheel_tickets(ticket_day);
CREATE INDEX IF NOT EXISTS idx_wc_month   ON wheel_contributions(raffle_month);
CREATE INDEX IF NOT EXISTS idx_ww_month   ON wheel_winners(raffle_month);
CREATE INDEX IF NOT EXISTS idx_wal_action ON wheel_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_wal_ts     ON wheel_audit_logs(created_at);

-- ─── 5. AI chat tables ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_knowledge_chunks (
  id           BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_url   TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  chunk        TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (content_hash)
);
CREATE INDEX IF NOT EXISTS idx_ai_kc_active ON ai_knowledge_chunks(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_ai_kc_source ON ai_knowledge_chunks(source_url);
CREATE INDEX IF NOT EXISTS idx_ai_kc_fts ON ai_knowledge_chunks USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || chunk));

CREATE TABLE IF NOT EXISTS public.ai_chat_logs (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ip_hash         TEXT,
  question        TEXT,
  answer          TEXT,
  matched_sources TEXT[],
  language        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 6. ai_match_knowledge_chunks RPC function ───────────────────────
CREATE OR REPLACE FUNCTION public.ai_match_knowledge_chunks(
  query_text  TEXT,
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id           BIGINT,
  source_url   TEXT,
  title        TEXT,
  chunk        TEXT,
  content_hash TEXT,
  rank         FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id, source_url, title, chunk, content_hash,
    ts_rank_cd(
      to_tsvector('english', coalesce(title,'') || ' ' || chunk),
      websearch_to_tsquery('english', query_text),
      32
    ) AS rank
  FROM public.ai_knowledge_chunks
  WHERE active = true
    AND to_tsvector('english', coalesce(title,'') || ' ' || chunk)
        @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.ai_match_knowledge_chunks TO anon, service_role;

-- ─── 7. ai_deactivate_knowledge_sources RPC function ─────────────────
CREATE OR REPLACE FUNCTION public.ai_deactivate_knowledge_sources(
  source_urls TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE updated INTEGER;
BEGIN
  UPDATE public.ai_knowledge_chunks
  SET active = false, updated_at = NOW()
  WHERE source_url = ANY(source_urls) AND active = true;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ai_deactivate_knowledge_sources TO service_role;

-- ─── 8. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.tcl_transfers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcl_trades           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcl_sync_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_tickets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_contributions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_winners        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_audit_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_knowledge_chunks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_logs         ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS (BYPASSRLS set on role)
-- anon: read-only on public tables
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tcl_transfers' AND policyname='anon_read') THEN
    CREATE POLICY anon_read ON tcl_transfers FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tcl_trades' AND policyname='anon_read') THEN
    CREATE POLICY anon_read ON tcl_trades FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tcl_sync_state' AND policyname='anon_read') THEN
    CREATE POLICY anon_read ON tcl_sync_state FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wheel_config' AND policyname='anon_read') THEN
    CREATE POLICY anon_read ON wheel_config FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wheel_tickets' AND policyname='anon_read') THEN
    CREATE POLICY anon_read ON wheel_tickets FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wheel_contributions' AND policyname='anon_read') THEN
    CREATE POLICY anon_read ON wheel_contributions FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wheel_winners' AND policyname='anon_read') THEN
    CREATE POLICY anon_read ON wheel_winners FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_knowledge_chunks' AND policyname='anon_read') THEN
    CREATE POLICY anon_read ON ai_knowledge_chunks FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- ─── 9. Grant table access to roles ──────────────────────────────────
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;

-- ─── 10. Seed ────────────────────────────────────────────────────────
INSERT INTO public.wheel_config (wheel_wallet, host_herotag, host_wallet, enabled)
VALUES ('', 'TCLexplorer', '', false)
ON CONFLICT DO NOTHING;
