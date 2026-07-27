-- Live-classroom fields for bookings.
--
-- Provider-agnostic on purpose: `meeting_provider` records which integration
-- created the event, so a booking can still be cancelled by the provider that
-- created it after the platform default changes (Google Meet -> Zoom/Teams).
--
-- The pre-existing `meeting_link` column (from 0006) is left in place rather
-- than renamed: it is unused and dropping a column is destructive. New code
-- reads/writes `meeting_url`.
alter table public.bookings
  add column if not exists meeting_provider text,
  add column if not exists meeting_url text,
  add column if not exists meeting_id text,
  add column if not exists calendar_event_id text,
  add column if not exists meeting_status text not null default 'pending';

-- Guards the state machine the service relies on.
alter table public.bookings
  drop constraint if exists bookings_meeting_status_check;
alter table public.bookings
  add constraint bookings_meeting_status_check
  check (meeting_status in ('pending', 'scheduled', 'failed', 'cancelled'));

-- Retry sweep: find confirmed lessons whose meeting never got created.
-- Partial index stays small — it only covers the transient failure set.
create index if not exists bookings_meeting_failed_idx
  on public.bookings (start_at)
  where meeting_status = 'failed';

-- No RLS changes needed: bookings policies already restrict rows to the
-- student, the tutor, and admins, and meeting fields are written exclusively
-- by the service role (MeetingService).
