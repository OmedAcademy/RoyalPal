-- =====================================================================
-- PENDING MIGRATIONS — run BEFORE any Stripe test-mode verification.
--
-- Applied on remote:      0001 .. 0023
-- NOT applied on remote:  0024, 0025   <-- this file
--
-- The webhook handlers already write these columns. Until this runs,
-- every transfer/dispute event will fail on a missing column.
--
-- Run either:
--   (a) Supabase Dashboard -> SQL Editor -> paste -> Run, or
--   (b) SUPABASE_DB_PASSWORD=<pw> npx supabase db push
--
-- Safe to run once. Re-running will error on duplicate columns, which is
-- the intended protection against double application.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0024_transfer_and_dispute_state.sql
-- ---------------------------------------------------------------------

alter table public.payments
  add column stripe_transfer_id text,
  add column transfer_status text,
  add column transfer_status_reason text,
  add column stripe_dispute_id text,
  add column dispute_status text;

alter table public.payments
  add constraint payments_transfer_status_check
  check (transfer_status is null or transfer_status in ('paid', 'reversed'));

create index payments_transfer_reversed_idx
  on public.payments (created_at desc)
  where transfer_status = 'reversed';

create index payments_disputed_idx
  on public.payments (created_at desc)
  where stripe_dispute_id is not null;


-- ---------------------------------------------------------------------
-- 0025_tutor_platform_fee_bps.sql
-- ---------------------------------------------------------------------

alter table public.tutor_profiles
  add column platform_fee_bps smallint;

alter table public.tutor_profiles
  add constraint tutor_profiles_platform_fee_bps_check
  check (platform_fee_bps is null or (platform_fee_bps >= 0 and platform_fee_bps <= 10000));


-- ---------------------------------------------------------------------
-- Verification — all five should return without error and show the
-- new columns as null for existing rows.
-- ---------------------------------------------------------------------

-- select stripe_transfer_id, transfer_status, transfer_status_reason,
--        stripe_dispute_id, dispute_status
-- from public.payments limit 1;

-- select platform_fee_bps from public.tutor_profiles limit 1;
