-- =====================================================================
-- PENDING MIGRATION — run BEFORE any Stripe test-mode verification.
--
-- Applied on remote:      0001 .. 0025   (0024/0025 verified applied)
-- NOT applied on remote:  0026           <-- this file
--
-- The account.updated webhook handler already writes these columns.
-- Until this runs, every Connect account event fails on a missing column.
--
-- Run either:
--   (a) Supabase Dashboard -> SQL Editor -> paste -> Run, or
--   (b) SUPABASE_DB_PASSWORD=<pw> npx supabase db push
--
-- SAFE TO RE-RUN. Written idempotently precisely because the SQL-editor
-- path can fail partway; re-running finishes the job rather than erroring
-- on already-created columns.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0026_connect_account_state.sql
-- ---------------------------------------------------------------------

alter table public.tutor_profiles
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_requirements_due text[] not null default '{}',
  add column if not exists stripe_disabled_reason text;

create index if not exists tutor_profiles_stripe_restricted_idx
  on public.tutor_profiles (id)
  where stripe_disabled_reason is not null;


-- ---------------------------------------------------------------------
-- Verification — should return a row (or an empty set) without error.
-- An error here means the migration did not apply.
-- ---------------------------------------------------------------------

-- select stripe_payouts_enabled, stripe_details_submitted,
--        stripe_requirements_due, stripe_disabled_reason
-- from public.tutor_profiles limit 1;
