-- Rescheduling a booking.
--
-- Why this needs a function at all: 0029's protect_booking_columns freezes
-- start_at and end_at for EVERY writer except postgres, deliberately — a
-- booking whose time can be moved by ordinary application code is a booking
-- whose time can be moved by an ordinary application bug. Rescheduling is the
-- one legitimate exception, so it gets exactly one door, and the door is
-- audited.
--
-- SECURITY DEFINER is what opens it: inside a function owned by postgres,
-- current_user IS postgres, so the existing lock lets the write through
-- without that lock being weakened for anybody else. Nothing else changes.
-- The price of that is that every guard the lock would have provided has to
-- be re-established here, which is what the body below is.
--
-- What is deliberately NOT checked here: whether the new time falls inside
-- the tutor's published availability. That rule lives in
-- lib/utils/availability-slots.ts and is applied by the Server Action before
-- it calls this function. Reimplementing it in SQL would give the project two
-- copies of its most intricate business rule, free to disagree. The split is:
-- TypeScript owns product policy, this function owns integrity — participant,
-- status, direction of time, duration, and (via the untouched exclusion
-- constraint) never double-booking the tutor.

create table public.booking_reschedules (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  requested_by uuid not null references public.profiles (id),
  previous_start_at timestamptz not null,
  previous_end_at timestamptz not null,
  new_start_at timestamptz not null,
  new_end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now()
);

create index booking_reschedules_booking_idx
  on public.booking_reschedules (booking_id, created_at desc);

alter table public.booking_reschedules enable row level security;

-- Readable by the people it happened to, so "moved from Tuesday" can be shown
-- in the lesson's history. Written only by the function below.
create policy "booking_reschedules_select_participant_or_admin"
  on public.booking_reschedules for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = booking_reschedules.booking_id
        and (b.student_id = auth.uid() or b.tutor_id = auth.uid())
    )
  );

grant select on public.booking_reschedules to authenticated;
grant all on public.booking_reschedules to service_role;

-- How many times one booking may be moved. Not a moral position — an abuse
-- bound. Without it, rescheduling is an unlimited free option on a tutor's
-- calendar: hold the slot, move it, hold the next one, forever.
create or replace function public.reschedule_booking(
  p_booking_id uuid,
  p_new_start_at timestamptz,
  p_reason text default null,
  p_max_reschedules integer default 3
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  actor uuid := auth.uid();
  is_system boolean := public.is_admin() or auth.role() = 'service_role';
  new_end timestamptz;
  used integer;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = '42501';
  end if;

  -- Identical refusal for "not yours" and "does not exist" would be ideal, but
  -- the row was already fetched; the caller-facing action collapses the two.
  if not is_system and (actor is null or actor not in (b.student_id, b.tutor_id)) then
    raise exception 'not permitted to reschedule this booking' using errcode = '42501';
  end if;

  if b.status not in ('pending_payment', 'confirmed') then
    raise exception 'only an upcoming booking can be rescheduled' using errcode = '42501';
  end if;

  if p_new_start_at <= now() then
    raise exception 'the new time must be in the future' using errcode = '42501';
  end if;

  if p_new_start_at = b.start_at then
    raise exception 'the new time is the same as the current time' using errcode = '42501';
  end if;

  -- Derived, never supplied: bookings_duration_matches_range would reject a
  -- mismatched pair anyway, and letting a caller pass end_at invites the
  -- silent lesson-length change that constraint exists to prevent.
  new_end := p_new_start_at + make_interval(mins => b.lesson_duration_minutes);

  if not is_system then
    select count(*) into used from public.booking_reschedules where booking_id = b.id;
    if used >= p_max_reschedules then
      raise exception 'this lesson has already been rescheduled the maximum number of times'
        using errcode = '42501';
    end if;
  end if;

  insert into public.booking_reschedules
    (booking_id, requested_by, previous_start_at, previous_end_at, new_start_at, new_end_at, reason)
  values
    (b.id, coalesce(actor, b.student_id), b.start_at, b.end_at, p_new_start_at, new_end, p_reason);

  -- bookings_no_double_booking (a GiST exclusion constraint, untouched by this
  -- function) raises 23P01 here if the tutor is already booked then. That is
  -- the check that must not be reimplemented in application code, so it isn't.
  update public.bookings
     set start_at = p_new_start_at,
         end_at = new_end,
         -- The old room is for the old time. The meeting service reschedules
         -- the calendar event and writes this back to 'scheduled'.
         meeting_status = case when meeting_status = 'scheduled' then 'pending' else meeting_status end
   where id = b.id
  returning * into b;

  return b;
end;
$$;

-- EXECUTE is granted to authenticated because the function does its own
-- authorization above; without this grant the definer's rights are irrelevant
-- because nobody can call it.
grant execute on function public.reschedule_booking(uuid, timestamptz, text, integer) to authenticated;
grant execute on function public.reschedule_booking(uuid, timestamptz, text, integer) to service_role;
