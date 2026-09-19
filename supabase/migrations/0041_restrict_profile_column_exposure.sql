-- Column-level exposure on public.profiles and public.tutor_profiles.
--
-- THE ROOT CAUSE
-- Row Level Security filters ROWS. It cannot scope COLUMNS. Three broad SELECT
-- policies therefore hand out whole rows:
--
--   * 0011 grants `select` on tutor_profiles to anon, and 0003's
--     tutor_profiles_select_public_or_own_or_admin admits every approved
--     tutor — so an UNAUTHENTICATED caller holding the anon key (which ships
--     in the web bundle and in both mobile binaries) can read
--     stripe_account_id, platform_fee_bps, stripe_disabled_reason and
--     stripe_requirements_due for every approved tutor. platform_fee_bps is
--     each tutor's negotiated commission rate.
--
--   * 0015's profiles_select_public_approved_tutor was written for
--     "full_name, avatar_url" (its own comment says so) and grants the whole
--     row, so any authenticated user reads every approved tutor's `phone` and
--     — since 0036 added it — `date_of_birth`.
--
--   * 0016's profiles_select_booking_participant does the same between the two
--     people on a booking, in both directions.
--
-- This repository already diagnosed the mechanism. 0019's comment reads:
-- "adding a broad 'reviewers are readable' policy would expose the ENTIRE row,
-- including phone. RLS can't scope columns". It solved that one case with a
-- definer-rights projection view and never generalised the fix.
--
-- WHY COLUMN PRIVILEGES HERE AND A VIEW THERE
-- 0019's view was the right tool for its case: review authors are students
-- whose rows are otherwise invisible, so a view CREATED access that no policy
-- granted. Here the access already exists and must be NARROWED, and the two
-- situations pull in opposite directions:
--
--   * Every cross-row read in this codebase already asks only for id,
--     full_name, avatar_url, country or timezone — verified against every
--     caller. The column set a stranger needs and the column set the owner
--     needs are the same, except for the tutor's own Stripe state, which moves
--     to the service role below. So there is nothing here that a view could
--     express and a column grant could not.
--
--   * Discovery reads tutor_profiles through PostgREST with embedded
--     resources (profiles!tutor_profiles_id_fkey, tutor_subjects), array
--     filters, ordering and an exact count. Views carry no foreign keys, so
--     routing discovery through one would break embedding and force that
--     query to be rewritten as several with a join in application code — a
--     large change to working search, for no security gain.
--
--   * Column privileges FAIL CLOSED as the schema grows. A column added to
--     profiles tomorrow is unreadable until somebody grants it. That is
--     precisely the failure that produced this finding: 0015 was correct when
--     written, and 0036 silently widened it by adding date_of_birth to a table
--     an old policy already exposed in full. A view would not have prevented
--     that; this does.
--
-- WHAT IS NOT CHANGED
-- No policy is dropped, added or altered. No table loses RLS. INSERT and
-- UPDATE privileges are untouched, so the write path and the column-lock
-- triggers in 0027, 0028 and 0036 behave exactly as before. Row visibility is
-- identical; only the set of readable columns narrows.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- `anon` holds no grant on profiles today. Revoked anyway so a future blanket
-- `grant select on all tables` cannot quietly restore it.
revoke select on public.profiles from anon;
revoke select on public.profiles from authenticated;

-- Everything except phone and date_of_birth. Both are written by privileged
-- paths only (handle_new_user inside the auth.users insert; anonymise_account
-- through the service role) and NEITHER is read anywhere in the application
-- by any client — verified across web, API and both mobile apps.
grant select (
  id,
  role,
  full_name,
  avatar_url,
  country,
  timezone,
  status,
  created_at,
  updated_at,
  age_confirmed_at,
  terms_accepted_at,
  terms_version,
  deletion_requested_at,
  anonymized_at
) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- tutor_profiles
-- ---------------------------------------------------------------------------
revoke select on public.tutor_profiles from anon;
revoke select on public.tutor_profiles from authenticated;

-- anon keeps exactly two columns, and only because the RLS policies on
-- availability_rules and availability_exceptions (0004) are written as
-- `exists (select 1 from tutor_profiles tp where tp.id = ... and
-- tp.verification_status = 'approved' or ...)`. Postgres checks table
-- privileges inside a policy expression against the QUERYING role, so
-- revoking anon's access outright also broke anon's read of the availability
-- tables — verified, it failed with "permission denied for table
-- tutor_profiles" rather than returning nothing.
--
-- Granting the two columns that subquery touches restores it and exposes
-- nothing new: anon can already enumerate approved tutors through
-- availability_rules and reviews, both of which 0011 grants it. Every
-- commercial and Stripe column stays unreadable to anon.
grant select (id, verification_status) on public.tutor_profiles to anon;

-- The six withheld columns are the tutor's Stripe and commission state:
--   stripe_account_id, stripe_payouts_enabled, stripe_details_submitted,
--   stripe_requirements_due, stripe_disabled_reason, platform_fee_bps
-- 0028 already establishes that these are written only by the account.updated
-- webhook; this makes them readable only through the service role too. The
-- four callers that legitimately need them — the tutor's own payouts page,
-- both Connect onboarding actions, and checkout's destination-charge lookup —
-- now read them with the service role, each scoped by an id the caller has
-- already been authorized for.
--
-- stripe_charges_enabled stays readable: it is a capability flag search needs
-- in order to say whether a tutor can accept a paid booking, and it reveals
-- nothing about the account behind it.
--
-- rejection_reason, rejection_notes and the verification_decided_* columns
-- stay readable because the ROW policy already confines them: a client sees a
-- tutor_profiles row only when it is approved, their own, or they are an
-- admin, and an approved tutor has no rejection recorded.
grant select (
  id,
  headline,
  bio,
  video_url,
  hourly_rate_cents,
  trial_price_cents,
  currency,
  languages_spoken,
  teaching_languages,
  specializations,
  years_experience,
  certifications,
  education,
  availability_note,
  verification_status,
  avg_rating,
  total_reviews,
  stripe_charges_enabled,
  rejection_reason,
  rejection_notes,
  verification_decided_at,
  verification_decided_by,
  created_at,
  updated_at
) on public.tutor_profiles to authenticated;
