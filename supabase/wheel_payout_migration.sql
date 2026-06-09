BEGIN;

ALTER TABLE public.wheel_winners
  ADD COLUMN IF NOT EXISTS claim_message TEXT,
  ADD COLUMN IF NOT EXISTS claim_signature TEXT,
  ADD COLUMN IF NOT EXISTS claim_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_tx JSONB,
  ADD COLUMN IF NOT EXISTS payout_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_error TEXT;

CREATE INDEX IF NOT EXISTS idx_wheel_winners_payout
  ON public.wheel_winners (paid_status, payout_submitted_at);

COMMIT;
