-- ============================================================
-- TCL PNL — coloana `enriched` + index partial pentru backlog
-- Ruleaza o singura data in Supabase SQL editor (dupa tcl-pnl.sql)
-- ============================================================
--
-- De ce: PNL corect are nevoie de coloana `operations` (toate leg-urile cu
-- valueUSD din /transactions?withOperations=true). Sync-ul din /tokens/transfers
-- lasa adesea operations=null pentru swap-urile multi-leg / prin aggregator
-- (aggregateEsdt, xo, ...). Nu putem gasi ieftin "operations is null" (coloana
-- jsonb neindexata => statement timeout / 500). Adaugam un flag boolean indexat
-- partial ca worker-ul sa dreneze backlog-ul, ieftin, ~N root-uri per rulare.
--
-- Default true: doar swap-urile root neenrichuite ajung false => indexul ramane
-- mic si selectiv (doar backlog-ul real, nu cele 360k+ randuri).

alter table public.tcl_transfers
  add column if not exists enriched boolean not null default true;

-- Index partial: doar root-urile care mai au nevoie de enrichment.
-- Query-ul worker-ului: enriched=false order by ts desc limit N  =>  index-only, instant.
create index if not exists tcl_transfers_need_enrich
  on public.tcl_transfers (ts desc)
  where enriched = false;

-- Marcheaza backlog-ul existent: swap-uri root (original_tx_hash null) cu
-- operations lipsa. Atinge doar subsetul relevant, nu toata tabela.
update public.tcl_transfers
set enriched = false
where operations is null
  and original_tx_hash is null
  and function in (
    'swapTokensFixedInput','swapTokensFixedOutput','multiPairSwap',
    'multiPairSwapTokensFixedInput','swap','aggregateEsdt','aggregateEgld',
    'xo','buySwap','composeTasks'
  );
