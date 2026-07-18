-- profiles: one row per auth.users, holds cross-role identity data.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  full_name text not null,
  avatar_url text,
  timezone text not null default 'UTC',
  phone text,
  status public.user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Admin-check helper used across every RLS policy in this project.
-- security definer + a fixed search_path lets it read `profiles` for the
-- calling user without RLS recursing back into itself, and closes off
-- search_path-hijacking as an attack vector.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- No delete policy: profile deletion happens only via auth.users cascade
-- (e.g. an admin-initiated account deletion through the service role),
-- never directly by a client.

create index profiles_role_idx on public.profiles (role);
