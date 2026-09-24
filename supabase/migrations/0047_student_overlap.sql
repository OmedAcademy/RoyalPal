-- A student must not hold two live lessons at the same instant.
-- bookings_no_double_booking already stops two students taking the same
-- tutor. This is the other side: one student, two tutors, overlapping
-- ranges. Cancelled and completed rows are excluded, same as the tutor
-- constraint, so history does not block a new booking.

alter table public.bookings
  add constraint bookings_no_student_overlap
  exclude using gist (
    student_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status in ('pending_payment', 'confirmed'));
