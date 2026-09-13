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

create trigger protect_booking_columns
  before update on public.bookings
  for each row execute function public.protect_booking_columns();

-- Reviews: a completed lesson is not enough — it must have been paid for.
-- reviews_insert_own_completed_booking (0008) accepted any of the student's
-- bookings in status 'completed', however it got there. The payment check
-- names reviews.booking_id explicitly: a bare booking_id inside the payments
-- subquery would bind to payments.booking_id and always be true.
drop policy if exists "reviews_insert_own_completed_booking" on public.reviews;

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

create trigger enforce_booking_insert_invariants
  before insert on public.bookings
  for each row execute function public.enforce_booking_insert_invariants();
