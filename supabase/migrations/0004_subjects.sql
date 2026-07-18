create table public.subjects (
  id serial primary key,
  name text not null unique,
  category text not null,
  slug text not null unique
);

alter table public.subjects enable row level security;

create policy "subjects_select_all"
  on public.subjects for select
  using (true);

create policy "subjects_admin_write"
  on public.subjects for all
  using (public.is_admin())
  with check (public.is_admin());

create table public.tutor_subjects (
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  subject_id integer not null references public.subjects (id) on delete cascade,
  primary key (tutor_id, subject_id)
);

alter table public.tutor_subjects enable row level security;

create policy "tutor_subjects_select_all"
  on public.tutor_subjects for select
  using (true);

create policy "tutor_subjects_manage_own_or_admin"
  on public.tutor_subjects for all
  using (auth.uid() = tutor_id or public.is_admin())
  with check (auth.uid() = tutor_id or public.is_admin());

create index tutor_subjects_subject_id_idx on public.tutor_subjects (subject_id);
