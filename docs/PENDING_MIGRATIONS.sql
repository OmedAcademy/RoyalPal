-- =====================================================================
-- PENDING MIGRATIONS — 0028 and 0029, for the production database.
--
-- Applied on production:      0001 .. 0027
-- NOT applied on production:  0028, 0029   <-- this file
--
-- DO NOT RUN until BOTH of these are true:
--
--   1. Every production deployment that uses this database is running
--      the service-role writes these migrations depend on:
--        0028 needs startTutorOnboarding  (lib/actions/stripe-connect.ts)
--        0029 needs createBooking         (lib/actions/booking.ts)
--      Run this before that code is live and tutor onboarding and booking
--      creation fail for everyone.
--
--   2. The read-only production check (0027 trigger check + Q0-Q9) has been
--      run and its results reviewed. 0028 stops tutors writing these
--      columns; it does not repair values already written.
--
-- Run: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--
-- What you will see: the editor shows only the LAST statement's result,
-- which is the verification at the bottom. PASS = all 7 rows read PASS.
-- An error starting "STOPPED before any change" means the database is
-- missing something these migrations need, and nothing was changed. After
-- any other error, the file is safe to re-run once the cause is fixed.
--
-- SAFE TO RE-RUN. The migration text below is copied unchanged from
-- supabase/migrations/, except for the lines ending "added for re-run
-- safety", which drop a trigger or policy before it is created again.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Pre-check: stops before any change if a prerequisite is missing.
-- ---------------------------------------------------------------------

do $$
declare
  missing text;
begin
  select string_agg(format('%s.%s', r.tbl, r.col), ', ')
    into missing
  from (values
    ('tutor_profiles', 'verification_status'),
    ('tutor_profiles', 'platform_fee_bps'),
    ('tutor_profiles', 'stripe_account_id'),
    ('tutor_profiles', 'stripe_charges_enabled'),
    ('tutor_profiles', 'stripe_payouts_enabled'),
    ('tutor_profiles', 'stripe_details_submitted'),
    ('tutor_profiles', 'stripe_requirements_due'),
    ('tutor_profiles', 'stripe_disabled_reason'),
    ('tutor_profiles', 'avg_rating'),
    ('tutor_profiles', 'total_reviews'),
    ('tutor_profiles', 'hourly_rate_cents'),
    ('tutor_profiles', 'trial_price_cents'),
    ('bookings', 'student_id'),
    ('bookings', 'tutor_id'),
    ('bookings', 'start_at'),
    ('bookings', 'end_at'),
    ('bookings', 'price_cents'),
    ('bookings', 'lesson_duration_minutes'),
    ('bookings', 'status'),
    ('bookings', 'cancellation_reason'),
    ('bookings', 'updated_at'),
    ('payments', 'booking_id'),
    ('payments', 'status'),
    ('reviews', 'booking_id'),
    ('reviews', 'student_id')
  ) as r(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = r.tbl
      and c.column_name = r.col
  );

  if missing is not null then
    raise exception 'STOPPED before any change: missing columns: %', missing;
  end if;

  if to_regprocedure('public.is_admin()') is null then
    raise exception 'STOPPED before any change: function public.is_admin() does not exist';
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- 0028_protect_tutor_platform_columns.sql
-- ---------------------------------------------------------------------

-- Locks the tutor_profiles columns the PLATFORM owns.
--
-- tutor_profiles_update_own_or_admin and tutor_profiles_insert_own (0003) scope
-- writes to the tutor's own ROW, not its columns. A tutor calling PostgREST
-- directly could set:
--   platform_fee_bps = 0       -> createBooking charges no commission
--   stripe_charges_enabled     -> skips the Connect booking gate
--   stripe_account_id          -> becomes transfer_data.destination
--   avg_rating / total_reviews -> tops the search ranking
-- and, through INSERT — the path every new tutor's first profile save takes —
-- verification_status = 'approved', which protect_tutor_verification_status
-- guards on UPDATE only.
--
--   system only (service role / definer functions):
--     stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled,
--     stripe_details_submitted, stripe_requirements_due,
--     stripe_disabled_reason, avg_rating, total_reviews
--   admin or system:  platform_fee_bps
--   tutor-editable:   everything else
--
-- SECURITY INVOKER for the reason given in 0027. It matters doubly here:
-- recompute_tutor_rating (0008) updates avg_rating from inside a SECURITY
-- DEFINER function while auth.role() still reports the reviewing student's
-- 'authenticated' JWT — a clone of the auth.role() check would reject that
-- update and break every review submission.
--
-- protect_tutor_verification_status still owns verification_status on UPDATE
-- and is not replaced. Requires 0025 and 0026.
create or replace function public.protect_tutor_platform_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Column defaults are already applied to NEW here, so a legitimate first
    -- save passes untouched; only an explicitly supplied value is refused.
    if new.verification_status is distinct from 'pending'
       or new.stripe_account_id is not null
       or new.stripe_charges_enabled is distinct from false
       or new.stripe_payouts_enabled is distinct from false
       or new.stripe_details_submitted is distinct from false
       or new.stripe_requirements_due is distinct from '{}'::text[]
       or new.stripe_disabled_reason is not null
       or new.avg_rating is not null
       or new.total_reviews is distinct from 0
       or new.platform_fee_bps is not null then
      raise exception 'tutor_profiles platform-controlled columns cannot be set by the tutor'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_charges_enabled is distinct from old.stripe_charges_enabled
     or new.stripe_payouts_enabled is distinct from old.stripe_payouts_enabled
     or new.stripe_details_submitted is distinct from old.stripe_details_submitted
     or new.stripe_requirements_due is distinct from old.stripe_requirements_due
     or new.stripe_disabled_reason is distinct from old.stripe_disabled_reason
     or new.avg_rating is distinct from old.avg_rating
     or new.total_reviews is distinct from old.total_reviews then
    raise exception 'Stripe account state and ratings are system-controlled'
      using errcode = '42501';
  end if;

  if new.platform_fee_bps is distinct from old.platform_fee_bps
     and not public.is_admin() then
    raise exception 'only an admin can change tutor_profiles.platform_fee_bps'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_tutor_platform_columns on public.tutor_profiles; -- added for re-run safety
create trigger protect_tutor_platform_columns
  before insert or update on public.tutor_profiles
  for each row execute function public.protect_tutor_platform_columns();


-- ---------------------------------------------------------------------
-- 0029_protect_booking_integrity.sql
-- ---------------------------------------------------------------------

-- Booking integrity: clients can no longer create bookings directly, or change
-- a booking's terms once it exists.
--
-- bookings_insert_own_as_student (0006) let any signed-in user INSERT a row
-- with any status, price, tutor or time: a lesson already 'confirmed' with no
-- payment, one already 'completed' that could then be reviewed, or one priced
-- at 50 cents that retryBookingPayment would then charge. createBooking now
-- validates and inserts through the service role, so the client INSERT path
-- is removed outright rather than patched column by column.
--
-- bookings_update_participant_or_admin still lets a participant UPDATE their
-- own booking, but RLS cannot scope columns: price, fee, time, tutor, subject,
-- student and meeting link were all editable after payment. The trigger below
-- leaves a signed-in client exactly two writable columns: status (still
-- policed by enforce_booking_status_transition) and cancellation_reason. The
-- whole row is compared, so any column added later is locked by default.
--
-- SECURITY INVOKER for the reason given in 0027: every check here reads
-- current_user. The client-only column lock exempts the service role
-- (createBooking, the Stripe webhook, the maintenance sweep, the meeting
-- service); the booking-terms lock and the insert invariants do not — see
-- their comments.
--
-- Apply only once the service-role insert in createBooking is the deployed
-- code, or booking creation fails for everyone.
revoke insert on public.bookings from authenticated;
drop policy if exists "bookings_insert_own_as_student" on public.bookings;

create or replace function public.protect_booking_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- A booking's terms are fixed at creation for EVERY writer except postgres:
  -- the same predicate, for the same reason, as the insert invariants below.
  -- The webhook, the sweep and the meeting service all run as service_role and
  -- none of them has any business repricing a lesson, moving it, or changing
  -- who it is between, so a bug in any of them must not be able to. postgres
  -- stays exempt so an operator can still correct a booking deliberately.
  if current_user <> 'postgres'
     and (new.price_cents, new.start_at, new.end_at, new.tutor_id, new.student_id)
         is distinct from (old.price_cents, old.start_at, old.end_at, old.tutor_id, old.student_id) then
    raise exception 'a booking''s price, time, tutor and student cannot be changed after it is created'
      using errcode = '42501';
  end if;

  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if (to_jsonb(new) - 'status' - 'cancellation_reason' - 'updated_at')
     is distinct from (to_jsonb(old) - 'status' - 'cancellation_reason' - 'updated_at') then
    raise exception 'only status and cancellation_reason can be changed on a booking'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_booking_columns on public.bookings; -- added for re-run safety
create trigger protect_booking_columns
  before update on public.bookings
  for each row execute function public.protect_booking_columns();

-- Reviews: a completed lesson is not enough — it must have been paid for.
-- reviews_insert_own_completed_booking (0008) accepted any of the student's
-- bookings in status 'completed', however it got there. The payment check
-- names reviews.booking_id explicitly: a bare booking_id inside the payments
-- subquery would bind to payments.booking_id and always be true.
drop policy if exists "reviews_insert_own_completed_booking" on public.reviews;

drop policy if exists "reviews_insert_own_completed_paid_booking" on public.reviews; -- added for re-run safety
create policy "reviews_insert_own_completed_paid_booking"
  on public.reviews for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.student_id = auth.uid()
        and b.status = 'completed'
    )
    and exists (
      select 1 from public.payments p
      where p.booking_id = reviews.booking_id
        and p.status = 'succeeded'
    )
  );

-- Insert invariants, for EVERY writer except postgres.
--
-- Clients no longer INSERT at all (above). createBooking inserts through the
-- service role, which RLS does not apply to, so without this a bug there could
-- create a booking already confirmed or completed, or priced wrong, and
-- nothing in the database would stop it.
--
-- Why postgres, and only postgres, is exempt: it is the SQL editor and the
-- migration runner — an operator acting deliberately, for example to repair
-- or backfill a booking — not an application code path. service_role is NOT
-- exempt, on purpose. This is deliberately a different predicate from
-- 0027/0028, which trust service_role: those guard against clients; this
-- guards against the server's own bugs.
--
-- COUPLED TO THE CURRENT RATE MODEL: price_cents must equal the tutor's
-- trial_price_cents for a 30-minute lesson, or hourly_rate_cents otherwise, as
-- stored at insert time. Discounts, promo codes, packages or any other pricing
-- will be refused here until this rule is changed along with them. The
-- platform fee is not checked: it depends on the PLATFORM_FEE_BPS environment
-- variable, which the database cannot see.
create or replace function public.enforce_booking_insert_invariants()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  rate_cents integer;
begin
  if current_user = 'postgres' then
    return new;
  end if;

  if new.status is distinct from 'pending_payment' then
    raise exception 'a booking must be created as pending_payment'
      using errcode = '42501';
  end if;

  select case when new.lesson_duration_minutes = 30
              then tp.trial_price_cents
              else tp.hourly_rate_cents end
    into rate_cents
    from public.tutor_profiles tp
   where tp.id = new.tutor_id;

  if rate_cents is null or new.price_cents is distinct from rate_cents then
    raise exception 'booking price does not match the tutor''s current rate'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_booking_insert_invariants on public.bookings; -- added for re-run safety
create trigger enforce_booking_insert_invariants
  before insert on public.bookings
  for each row execute function public.enforce_booking_insert_invariants();


-- ---------------------------------------------------------------------
-- Verification (read-only). This is the result the editor shows.
-- PASS = all 7 rows read PASS; any FAIL row names what is missing.
-- To re-check later without re-applying anything, highlight from
-- "with trig as" to the end of the file and run only that selection.
-- ---------------------------------------------------------------------

with trig as (
  select t.tgname, c.relname, t.tgenabled, t.tgtype, p.prosecdef
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public'
    and not t.tgisinternal
),
checks (ord, migration, check_name, pass) as (
  select 1, '0028', 'trigger protect_tutor_platform_columns: BEFORE INSERT OR UPDATE on tutor_profiles, enabled, SECURITY INVOKER',
         exists (select 1 from trig where tgname = 'protect_tutor_platform_columns' and relname = 'tutor_profiles'
                 and tgenabled = 'O' and tgtype = 23 and not prosecdef)
  union all
  select 2, '0029', 'trigger protect_booking_columns: BEFORE UPDATE on bookings, enabled, SECURITY INVOKER',
         exists (select 1 from trig where tgname = 'protect_booking_columns' and relname = 'bookings'
                 and tgenabled = 'O' and tgtype = 19 and not prosecdef)
  union all
  select 3, '0029', 'trigger enforce_booking_insert_invariants: BEFORE INSERT on bookings, enabled, SECURITY INVOKER',
         exists (select 1 from trig where tgname = 'enforce_booking_insert_invariants' and relname = 'bookings'
                 and tgenabled = 'O' and tgtype = 7 and not prosecdef)
  union all
  select 4, '0029', 'role authenticated has no INSERT privilege on bookings (table or column)',
         not has_any_column_privilege('authenticated', 'public.bookings', 'INSERT')
  union all
  select 5, '0029', 'no INSERT or ALL policy remains on bookings',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bookings'
                     and cmd in ('INSERT', 'ALL'))
  union all
  select 6, '0029', 'old review policy reviews_insert_own_completed_booking is gone',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reviews'
                     and policyname = 'reviews_insert_own_completed_booking')
  union all
  select 7, '0029', 'review policy reviews_insert_own_completed_paid_booking exists and requires a succeeded payment',
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reviews'
                 and policyname = 'reviews_insert_own_completed_paid_booking' and cmd = 'INSERT'
                 and with_check ilike '%payments%' and with_check ilike '%succeeded%')
)
select migration, check_name, case when pass then 'PASS' else 'FAIL' end as result
from checks
order by ord
