create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id),
  tutor_id uuid not null references public.tutor_profiles (id),
  subject_id integer not null references public.subjects (id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  lesson_duration_minutes integer not null default 50 check (lesson_duration_minutes > 0),
  status public.booking_status not null default 'pending_payment',
  meeting_link text,
  price_cents integer not null check (price_cents >= 0),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  currency text not null default 'usd',
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_end_after_start check (end_at > start_at),
  -- Keeps end_at and lesson_duration_minutes from drifting apart.
  constraint bookings_duration_matches_range
    check (end_at = start_at + make_interval(mins => lesson_duration_minutes))
);

-- Database-level guarantee against double-booking a tutor: no two
-- pending_payment/confirmed bookings for the same tutor may overlap in time.
-- This is intentionally not left to application logic alone.
alter table public.bookings
  add constraint bookings_no_double_booking
  exclude using gist (
    tutor_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status in ('pending_payment', 'confirmed'));

create trigger set_bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- Validates every status change against an explicit transition matrix and
-- gates who is allowed to make each transition, so a bug in a Server Action
-- can't silently corrupt booking state (e.g. a student self-confirming a
-- booking without paying).
create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'pending_payment' and new.status = 'confirmed' then
    if auth.role() <> 'service_role' and not public.is_admin() then
      raise exception 'only the payment webhook or an admin can confirm a booking';
    end if;

  elsif old.status = 'pending_payment' and new.status = 'cancelled' then
    if not (auth.uid() = old.student_id or public.is_admin() or auth.role() = 'service_role') then
      raise exception 'not permitted to cancel this booking';
    end if;

  elsif old.status = 'confirmed' and new.status = 'cancelled' then
    if not (
      auth.uid() = old.tutor_id
      or auth.uid() = old.student_id
      or public.is_admin()
      or auth.role() = 'service_role'
    ) then
      raise exception 'not permitted to cancel this booking';
    end if;

  elsif old.status = 'confirmed' and new.status = 'completed' then
    if not (public.is_admin() or auth.role() = 'service_role') then
      raise exception 'only an admin or the system can mark a booking completed';
    end if;

  elsif old.status in ('confirmed', 'completed') and new.status = 'refunded' then
    if not (public.is_admin() or auth.role() = 'service_role') then
      raise exception 'only an admin or the system can refund a booking';
    end if;

  else
    raise exception 'invalid booking status transition from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger enforce_bookings_status_transition
  before update on public.bookings
  for each row execute function public.enforce_booking_status_transition();

alter table public.bookings enable row level security;

create policy "bookings_select_participant_or_admin"
  on public.bookings for select
  using (auth.uid() = student_id or auth.uid() = tutor_id or public.is_admin());

create policy "bookings_insert_own_as_student"
  on public.bookings for insert
  with check (auth.uid() = student_id);

create policy "bookings_update_participant_or_admin"
  on public.bookings for update
  using (
    auth.uid() = student_id
    or auth.uid() = tutor_id
    or public.is_admin()
    or auth.role() = 'service_role'
  )
  with check (
    auth.uid() = student_id
    or auth.uid() = tutor_id
    or public.is_admin()
    or auth.role() = 'service_role'
  );

-- No delete policy: bookings are never hard-deleted, only moved to a
-- terminal status (cancelled/refunded), preserving the audit trail.

create index bookings_tutor_id_start_at_idx on public.bookings (tutor_id, start_at);
create index bookings_student_id_idx on public.bookings (student_id);
create index bookings_status_idx on public.bookings (status);
