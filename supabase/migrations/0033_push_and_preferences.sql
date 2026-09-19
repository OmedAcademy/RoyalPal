-- Mobile push delivery and per-user notification preferences.
--
-- push_tokens is one row per DEVICE, not per user: a person with a phone and
-- a tablet must get both, and a person who reinstalls must not keep receiving
-- on a token that no longer exists. `token` is unique across the whole table
-- for a reason that only shows up in production — when one person signs out
-- of a shared device and another signs in, the push provider reissues the
-- SAME token to the new account. Without uniqueness, both rows survive and
-- the previous user's lesson reminders go to the new user's lock screen.
-- Registration therefore claims the token rather than adding a row (see the
-- upsert in lib/notifications/push.ts).
--
-- NO CLIENT WRITE PATH. Registration runs through the service role. A client
-- INSERT policy would have to allow writing a row keyed by a token the client
-- supplies, which is exactly how one account attaches itself to another
-- account's device. Clients may read and delete their own rows (so "sign out
-- of this device" works) and nothing else.

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  -- Free text from the device, shown in "your devices". Never trusted for
  -- anything but display.
  device_name text,
  -- A token the provider has told us is dead. Kept rather than deleted so a
  -- delivery failure is visible in the data instead of silently vanishing.
  disabled_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id) where disabled_at is null;

alter table public.push_tokens enable row level security;

create policy "push_tokens_select_own_or_admin"
  on public.push_tokens for select
  using (auth.uid() = user_id or public.is_admin());

create policy "push_tokens_delete_own"
  on public.push_tokens for delete
  using (auth.uid() = user_id);

grant select, delete on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;

-- ---------------------------------------------------------------------------
-- Notification preferences.
--
-- Modelled as OPT-OUT ROWS, not a settings record: a row exists only where a
-- user has turned something off, and its absence means on. Two consequences
-- worth the unusual shape —
--   1. Adding a notification category ships without a migration and without
--      backfilling every existing user, matching the decision already made in
--      0020 that the application, not the schema, owns this vocabulary.
--   2. There is no "user has no preferences row yet" case to get wrong at
--      2am; the default is the absence of data.
--
-- `channel` and `category` are text for the same reason they are in
-- notifications. Transactional mail that a user cannot opt out of (password
-- reset, security, account) is never routed through this table at all — it is
-- sent directly, so there is no row that could switch it off.
create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('email', 'push')),
  category text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel, category)
);

alter table public.notification_preferences enable row level security;

create policy "notification_preferences_manage_own_or_admin"
  on public.notification_preferences for all
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

grant select, insert, update, delete on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;
