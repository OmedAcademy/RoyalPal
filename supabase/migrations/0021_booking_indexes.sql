-- Engineering-excellence pass: indexes for the hot booking paths.
--
-- Before this, three high-frequency query shapes had no covering index and
-- degraded to sequential scans as the bookings table grew:
--
--  1. Per-user booking lists (dashboards + bookings pages) filter by
--     student_id or tutor_id and order by start_at.
--  2. The maintenance sweep finds confirmed lessons whose end_at has passed.
--  3. The maintenance sweep finds stale pending_payment bookings.
--
-- (2) and (3) are partial indexes: they only cover the small, transient slice
-- of rows in those states, so they stay tiny no matter how large the table's
-- completed/cancelled history becomes.

create index if not exists bookings_student_start_idx
  on public.bookings (student_id, start_at desc);

create index if not exists bookings_tutor_start_idx
  on public.bookings (tutor_id, start_at desc);

create index if not exists bookings_confirmed_end_idx
  on public.bookings (end_at)
  where status = 'confirmed';

create index if not exists bookings_pending_created_idx
  on public.bookings (created_at)
  where status = 'pending_payment';
