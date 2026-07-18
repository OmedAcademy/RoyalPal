-- Lightweight audit log for admin actions (suspend user, refund booking,
-- approve/reject tutor, etc). target_id is intentionally polymorphic
-- (no FK) since it can point at a profile, a booking, or other entities.
create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id),
  action text not null,
  target_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.admin_actions enable row level security;

create policy "admin_actions_admin_only"
  on public.admin_actions for all
  using (public.is_admin())
  with check (public.is_admin());

create index admin_actions_admin_id_idx on public.admin_actions (admin_id);
