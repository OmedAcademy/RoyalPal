-- Per-tutor commission override.
--
-- Null (the default for every existing and future tutor) means "use the
-- platform rate" — resolved in lib/pricing/commission.ts from the
-- PLATFORM_FEE_BPS env var, falling back to DEFAULT_PLATFORM_FEE_BPS.
-- A column rather than a config table because there is exactly one rate
-- per tutor and no history to model yet; a negotiated-rates table becomes
-- worth it only when rates need effective dates.
--
-- Basis points, not a percentage float: the fee and the tutor's payout are
-- two halves of the same integer amount, and a float rate makes them round
-- independently. 1000 bps = 10%.
alter table public.tutor_profiles
  add column platform_fee_bps smallint;

-- 0 is a legitimate value (a zero-commission tutor); 10000 bps = 100% is the
-- ceiling, since a fee above the price would mean paying the tutor negative
-- money. smallint tops out at 32767 so the upper bound must be explicit.
alter table public.tutor_profiles
  add constraint tutor_profiles_platform_fee_bps_check
  check (platform_fee_bps is null or (platform_fee_bps >= 0 and platform_fee_bps <= 10000));

-- No RLS change needed: tutor_profiles_update_own_or_admin already governs
-- writes. NOTE that this means a tutor could set their OWN commission to 0
-- through that policy. There is no UI for it, and createBooking reads the
-- value server-side, so this is not currently reachable — but it is the
-- reason this column must gain an admin-only guard (a trigger mirroring
-- protect_tutor_verification_status) before any tutor-facing rate editing
-- ships. Flagged deliberately rather than left implicit.
