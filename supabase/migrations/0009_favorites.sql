-- A student's saved/bookmarked tutors. Deliberately private: a tutor cannot
-- see who has favorited them, only the student who owns the row (and admin).
create table public.favorites (
  student_id uuid not null references public.profiles (id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, tutor_id)
);

alter table public.favorites enable row level security;

create policy "favorites_manage_own_or_admin"
  on public.favorites for all
  using (auth.uid() = student_id or public.is_admin())
  with check (auth.uid() = student_id or public.is_admin());
