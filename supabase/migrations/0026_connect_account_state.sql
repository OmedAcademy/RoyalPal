-- Fuller Connect account state.
--
-- Until now only stripe_charges_enabled was mirrored, which collapses three
-- genuinely different situations into one "not active" bucket:
--   • the tutor never finished onboarding          -> they must go back
--   • Stripe is still verifying submitted details  -> they must wait
--   • Stripe restricted the account                -> they must fix something
-- A tutor told "onboarding incomplete" when Stripe actually wants a new ID
-- document will retry the same flow forever. These columns are what let the
-- UI say the true thing.
alter table public.tutor_profiles
  add column stripe_payouts_enabled boolean not null default false,
  add column stripe_details_submitted boolean not null default false,
  add column stripe_requirements_due text[] not null default '{}',
  add column stripe_disabled_reason text;

-- Note the deliberate split between charges_enabled and payouts_enabled.
-- They are NOT the same flag: an account can accept charges (so lessons are
-- bookable, gated in createBooking) while payouts to its bank are paused
-- (so money accumulates in the Stripe balance). Treating them as one value
-- would either block bookable tutors or silently imply tutors are being
-- paid when they are not.

-- Operational queue: accounts Stripe is actively blocking. Partial index
-- stays small — in normal operation this set is empty.
create index tutor_profiles_stripe_restricted_idx
  on public.tutor_profiles (id)
  where stripe_disabled_reason is not null;

-- No RLS change: tutor_profiles policies already scope reads/writes, and
-- every column here is written exclusively by the account.updated webhook
-- through the service role. They are mirrors of Stripe's state, never
-- authored by us — which is why none of them is writable from the UI.
