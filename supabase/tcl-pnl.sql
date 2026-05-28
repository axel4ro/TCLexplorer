-- ============================================================
-- TCL PNL — schema Supabase
-- Ruleaza o singura data in Supabase SQL editor
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabela principala: toate transferurile TCL-fe459d globale
-- ------------------------------------------------------------
create table if not exists public.tcl_transfers (
  tx_hash          text primary key,
  original_tx_hash text,
  type             text,                  -- Transaction / SmartContractResult
  sender           text not null,
  receiver         text not null,
  ts               integer not null,      -- unix timestamp
  function         text,
  status           text default 'success',
  action_transfers jsonb,                 -- entry.action.arguments.transfers[]
  operations       jsonb,                 -- entry.operations[] (cu withOperations=true)
  synced_at        timestamptz default now()
);

create index if not exists tcl_transfers_sender_ts
  on public.tcl_transfers (sender, ts desc);

create index if not exists tcl_transfers_receiver_ts
  on public.tcl_transfers (receiver, ts desc);

create index if not exists tcl_transfers_ts
  on public.tcl_transfers (ts desc);

create index if not exists tcl_transfers_orig
  on public.tcl_transfers (original_tx_hash)
  where original_tx_hash is not null;

-- ------------------------------------------------------------
-- 2. Swap-uri pre-procesate (buy/sell)
-- ------------------------------------------------------------
create table if not exists public.tcl_trades (
  tx_hash     text primary key,
  ts          integer not null,
  wallet      text not null,
  side        text not null,      -- 'buy' sau 'sell'
  tcl_amount  numeric not null,
  usdc_amount numeric not null,
  price       numeric not null,   -- usdc per tcl
  source      text,               -- 'operations' sau 'pair_transfer'
  synced_at   timestamptz default now()
);

create index if not exists tcl_trades_wallet_ts
  on public.tcl_trades (wallet, ts desc);

create index if not exists tcl_trades_ts
  on public.tcl_trades (ts desc);

-- ------------------------------------------------------------
-- 3. Starea sync-ului (progress tracking)
-- ------------------------------------------------------------
create table if not exists public.tcl_sync_state (
  key   text primary key,
  value text
);
-- Chei folosite:
--   'newest_ts'        => timestamp maxim sincronizat (pentru incremental)
--   'backfill_offset'  => offset-ul urmator pentru backfill (order=asc)
--   'backfill_done'    => 'true' daca backfill-ul complet s-a terminat
--   'total_synced'     => numarul total de randuri in tcl_transfers

-- ------------------------------------------------------------
-- 4. RLS (Row Level Security)
-- ------------------------------------------------------------
alter table public.tcl_transfers   enable row level security;
alter table public.tcl_trades      enable row level security;
alter table public.tcl_sync_state  enable row level security;

-- Oricine poate citi (datele sunt publice - e blockchain)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'tcl_transfers' and policyname = 'tcl_transfers_read'
  ) then
    create policy "tcl_transfers_read"
      on public.tcl_transfers for select using (true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'tcl_trades' and policyname = 'tcl_trades_read'
  ) then
    create policy "tcl_trades_read"
      on public.tcl_trades for select using (true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'tcl_sync_state' and policyname = 'tcl_sync_state_read'
  ) then
    create policy "tcl_sync_state_read"
      on public.tcl_sync_state for select using (true);
  end if;
end $$;

-- service_role (worker-ul) bypasses RLS automat, nu are nevoie de policy pentru write
