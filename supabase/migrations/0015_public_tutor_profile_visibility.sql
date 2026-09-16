-- M4: Tutor discovery. Students need to read a tutor's `profiles` row
-- (full_name, avatar_url) to render search results and tutor detail pages,
-- but profiles_select_own_or_admin (0002) only allows a user to see their
-- own row. Mirror tutor_profiles' existing public-when-approved rule here,
-- scoped to the same condition, rather than opening `profiles` up broadly.

create policy "profiles_select_public_approved_tutor"
  on public.profiles for select
  using (
    exists (
      select 1 from public.tutor_profiles tp
      where tp.id = profiles.id and tp.verification_status = 'approved'
    )
  );
