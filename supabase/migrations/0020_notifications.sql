-- Phase 2: Notifications.
--
-- `type` and `category` are text (not enums) and `data` is jsonb on purpose:
-- new notification kinds and new payload fields can ship without a schema
-- migration — the application owns the vocabulary. Rows are written only by
-- the service role (NotificationService); clients can read, mark-read, and
-- delete their own, and admins can read all.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  category text not null default 'general',
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Feed query: a user's notifications, newest first.
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- Unread-badge query: partial index keeps it tiny and fast at scale.
create index notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

create policy "notifications_select_own_or_admin"
  on public.notifications for select
  using (auth.uid() = user_id or public.is_admin());

-- Owner may update their own rows (only ever to set read_at from the UI).
create policy "notifications_update_own"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "notifications_delete_own"
  on public.notifications for delete
  using (auth.uid() = user_id);

-- No INSERT policy: notifications are created exclusively by the service
-- role via NotificationService, never directly by a client.

grant select, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
