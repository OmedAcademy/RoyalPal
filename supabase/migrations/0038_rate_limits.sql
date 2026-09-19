-- Rate limiting, in Postgres.
--
-- WHY NOT IN MEMORY
-- The booking maintenance sweep already learned this lesson the expensive
-- way: a module-level variable on Vercel is per-LAMBDA-INSTANCE, so a counter
-- kept there is reset by the platform scaling up and enforces nothing under
-- exactly the load that makes you want it. An attacker does not need to
-- defeat an in-memory limiter; they only need concurrency.
--
-- WHY NOT REDIS
-- Upstash or similar would be the textbook answer and is a better fit at
-- scale. It is also another vendor, another secret, another failure mode, and
-- another thing to configure before launch. Postgres is already here, already
-- transactional, and a fixed-window counter is a single atomic upsert. When
-- the traffic justifies Redis this function is the only thing that changes.
--
-- FIXED WINDOW, NOT SLIDING
-- A fixed window admits up to 2x the limit across a window boundary. That is
-- a real and known weakness, and it is the right trade here: the threats
-- being priced out (credential stuffing, signup floods, message spam) are
-- about sustained volume over minutes, not about a burst of 2x for one
-- second. A sliding window costs a row per request and a range scan to
-- enforce; this costs one row per key per window.

create table public.rate_limits (
  -- Caller-defined and opaque to the database, e.g. "login:user@example.com"
  -- or "message:<uuid>". The application is responsible for never putting a
  -- raw secret in it — see consumeRateLimit's hashing of email identifiers.
  key text not null,
  window_started_at timestamptz not null,
  count integer not null default 0,
  primary key (key, window_started_at)
);

-- Sweep target for the cleanup job. Old windows are dead weight the moment
-- they expire.
create index rate_limits_window_idx on public.rate_limits (window_started_at);

alter table public.rate_limits enable row level security;
-- No policies at all: this table is service-role only, and RLS with zero
-- policies denies every authenticated and anonymous access by default. A
-- client that could read it could enumerate who has been trying to log in.

grant all on public.rate_limits to service_role;

-- Atomically consume one unit against a key, returning whether it was
-- allowed. The whole check-and-increment is a single statement on purpose:
-- read-then-write from application code is a race that two concurrent
-- requests win together, which is precisely the scenario being defended
-- against.
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  win_start timestamptz;
  new_count integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'rate limit and window must be positive';
  end if;

  -- Truncate now() to the window grid so every caller agrees on the current
  -- window without coordinating.
  win_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as rl (key, window_started_at, count)
  values (p_key, win_start, 1)
  on conflict (key, window_started_at)
    do update set count = rl.count + 1
  returning rl.count into new_count;

  return query select
    new_count <= p_limit,
    greatest(p_limit - new_count, 0),
    win_start + make_interval(secs => p_window_seconds);
end;
$$;

-- Not granted to authenticated: every call goes through the service role, so
-- a client can never probe or exhaust someone else's bucket.
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
