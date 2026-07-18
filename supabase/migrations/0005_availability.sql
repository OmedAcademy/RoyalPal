-- Recurring weekly template.
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_at timestamptz not null default now()
);

-- One-off overrides: is_available = false blocks a date/range (vacation),
-- is_available = true opens an extra slot outside the recurring template.
create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  date date not null,
  start_time time,
  end_time time,
  is_available boolean not null,
  created_at timestamptz not null default now(),
  constraint availability_exceptions_time_range check (
    (start_time is null and end_time is null) or (end_time > start_time)
  )
);

alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;

create policy "availability_rules_select_public_or_own_or_admin"
  on public.availability_rules for select
  using (
    exists (
      select 1 from public.tutor_profiles tp
      where tp.id = availability_rules.tutor_id
        and (tp.verification_status = 'approved' or tp.id = auth.uid() or public.is_admin())
    )
  );

create policy "availability_rules_insert_own"
  on public.availability_rules for insert
  with check (auth.uid() = tutor_id);

create policy "availability_rules_update_own_or_admin"
  on public.availability_rules for update
  using (auth.uid() = tutor_id or public.is_admin())
  with check (auth.uid() = tutor_id or public.is_admin());

create policy "availability_rules_delete_own_or_admin"
  on public.availability_rules for delete
  using (auth.uid() = tutor_id or public.is_admin());

create policy "availability_exceptions_select_public_or_own_or_admin"
  on public.availability_exceptions for select
  using (
    exists (
      select 1 from public.tutor_profiles tp
      where tp.id = availability_exceptions.tutor_id
        and (tp.verification_status = 'approved' or tp.id = auth.uid() or public.is_admin())
    )
  );

create policy "availability_exceptions_insert_own"
  on public.availability_exceptions for insert
  with check (auth.uid() = tutor_id);

create policy "availability_exceptions_update_own_or_admin"
  on public.availability_exceptions for update
  using (auth.uid() = tutor_id or public.is_admin())
  with check (auth.uid() = tutor_id or public.is_admin());

create policy "availability_exceptions_delete_own_or_admin"
  on public.availability_exceptions for delete
  using (auth.uid() = tutor_id or public.is_admin());

create index availability_rules_tutor_id_idx on public.availability_rules (tutor_id);
create index availability_exceptions_tutor_id_date_idx
  on public.availability_exceptions (tutor_id, date);
