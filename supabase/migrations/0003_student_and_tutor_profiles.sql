-- Enforces that a row in student_profiles/tutor_profiles can only be attached
-- to a profiles row that actually has the matching role, e.g. blocks a
-- tutor_profiles row from being created for a profile whose role is 'student'.
create or replace function public.check_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_role public.user_role := TG_ARGV[0]::public.user_role;
  actual_role public.user_role;
begin
  select role into actual_role from public.profiles where id = new.id;

  if actual_role is null then
    raise exception 'profile % does not exist', new.id;
  end if;

  if actual_role <> expected_role then
    raise exception 'profile % has role % but % requires role %',
      new.id, actual_role, TG_TABLE_NAME, expected_role;
  end if;

  return new;
end;
$$;

-- student_profiles: 1:1 with profiles where role = 'student'.
-- Deliberately thin for MVP; search/matching fields grow here later.
create table public.student_profiles (
  id uuid primary key references public.profiles (id) on delete cascade,
  learning_goals text,
  preferred_languages text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger enforce_student_profile_role
  before insert on public.student_profiles
  for each row execute function public.check_profile_role('student');

create trigger set_student_profiles_updated_at
  before update on public.student_profiles
  for each row execute function public.set_updated_at();

alter table public.student_profiles enable row level security;

create policy "student_profiles_select_own_or_admin"
  on public.student_profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "student_profiles_insert_own"
  on public.student_profiles for insert
  with check (auth.uid() = id);

create policy "student_profiles_update_own_or_admin"
  on public.student_profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- tutor_profiles: 1:1 with profiles where role = 'tutor'.
-- Public visibility is gated by verification_status = 'approved', not a
-- self-serve is_published flag: only an admin can make a tutor discoverable.
create table public.tutor_profiles (
  id uuid primary key references public.profiles (id) on delete cascade,
  headline text not null,
  bio text not null,
  video_url text,
  hourly_rate_cents integer not null check (hourly_rate_cents > 0),
  currency text not null default 'usd',
  languages text[] not null default '{}',
  verification_status public.tutor_verification_status not null default 'pending',
  avg_rating numeric(2, 1),
  total_reviews integer not null default 0,
  stripe_account_id text,
  stripe_charges_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger enforce_tutor_profile_role
  before insert on public.tutor_profiles
  for each row execute function public.check_profile_role('tutor');

create trigger set_tutor_profiles_updated_at
  before update on public.tutor_profiles
  for each row execute function public.set_updated_at();

-- Only an admin (or the service role, e.g. a future automated verification
-- job) may change verification_status. A tutor editing their own profile
-- cannot self-approve.
create or replace function public.protect_tutor_verification_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status is distinct from old.verification_status
     and not public.is_admin()
     and auth.role() <> 'service_role' then
    raise exception 'only an admin can change tutor verification_status';
  end if;
  return new;
end;
$$;

create trigger protect_tutor_verification_status
  before update on public.tutor_profiles
  for each row execute function public.protect_tutor_verification_status();

alter table public.tutor_profiles enable row level security;

create policy "tutor_profiles_select_public_or_own_or_admin"
  on public.tutor_profiles for select
  using (
    verification_status = 'approved'
    or auth.uid() = id
    or public.is_admin()
  );

create policy "tutor_profiles_insert_own"
  on public.tutor_profiles for insert
  with check (auth.uid() = id);

create policy "tutor_profiles_update_own_or_admin"
  on public.tutor_profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

create index tutor_profiles_verification_status_idx
  on public.tutor_profiles (verification_status);
