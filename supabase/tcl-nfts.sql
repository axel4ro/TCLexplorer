-- ============================================================
-- TCL NFT Index — tabel pentru caching NFT-uri TCL pe server
-- Rulează o singură dată în psql / pgAdmin
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tcl_nfts (
  identifier       TEXT PRIMARY KEY,           -- e.g. TCLDAGGER-f9869a-31
  collection       TEXT NOT NULL,              -- e.g. TCLDAGGER-f9869a
  nonce            BIGINT NOT NULL,
  name             TEXT,
  image_url        TEXT,
  metadata         JSONB,                      -- { attributes: [...] }
  royalties        INTEGER DEFAULT 0,          -- basis points (500 = 5%)
  creator          TEXT,
  owner            TEXT,
  supply           TEXT DEFAULT '1',
  raw_api          JSONB,                      -- full MultiversX API response
  synced_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tcl_nfts_collection ON public.tcl_nfts (collection);
CREATE INDEX IF NOT EXISTS tcl_nfts_owner      ON public.tcl_nfts (owner);
CREATE INDEX IF NOT EXISTS tcl_nfts_synced_at  ON public.tcl_nfts (synced_at DESC);

-- ── Collections cache ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tcl_collections (
  collection       TEXT PRIMARY KEY,
  name             TEXT,
  image_url        TEXT,
  creator          TEXT,
  nft_count        INTEGER DEFAULT 0,
  raw_api          JSONB,
  synced_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sync state ────────────────────────────────────────────────────────────────
INSERT INTO public.tcl_nfts (identifier, collection, nonce, name) VALUES ('__init__', '__init__', 0, 'init')
  ON CONFLICT DO NOTHING;
DELETE FROM public.tcl_nfts WHERE identifier = '__init__';
