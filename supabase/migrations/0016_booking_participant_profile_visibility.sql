-- M5: Booking dashboards. A tutor needs to read a student's `profiles` row
-- (full_name) to render their booking list, but profiles_select_own_or_admin
-- (0002) only allows a user to see their own row, and
-- profiles_select_public_approved_tutor (0015) only covers the tutor
-- direction. Grant visibility in both directions, scoped to actual booking
-- participants rather than opening `profiles` up broadly.

create policy "profiles_select_booking_participant"
  on public.profiles for select
  using (
    exists (
      select 1 from public.bookings b
      where (b.student_id = profiles.id and b.tutor_id = auth.uid())
         or (b.tutor_id = profiles.id and b.student_id = auth.uid())
    )
  );
