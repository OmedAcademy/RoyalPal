-- SUP-3: rate limits that hold at the write boundary, not only in the action.
--
-- consumeRateLimit() in lib/rate-limit/limiter.ts enforces 5 tickets an hour
-- and 20 replies an hour. It runs inside the Server Action, which is not the
-- boundary: the anon key is public by design, so anyone holding a session can
-- POST straight to PostgREST and skip it entirely. Measured, not assumed — 50
-- tickets inserted directly against a documented 5/hour policy.
--
-- That is a flood path into the safeguarding queue specifically: the queue a
-- human reads, where burying a real report under noise is the harm.
--
-- COUNTED FROM THE ROWS, NOT FROM rate_limits
-- The limiter's counters are keyed on a hash the application computes, and
-- consuming the same bucket here would double-count every honest request and
-- silently halve the real limit. Counting the tickets themselves needs no
-- coordination, cannot drift, and is self-healing.
--
-- WHY THE SAME NUMBERS DO NOT MAKE THIS FIRE IN NORMAL USE
-- The action's limiter counts ATTEMPTS, including ones that never became a
-- row; this counts rows. So the action always refuses first, with a message
-- someone can act on, and this stays invisible to every honest client. It
-- exists for the client that is not going through the action at all.
--
-- These numbers mirror RATE_LIMITS in lib/rate-limit/limiter.ts. Two places is
-- one more than ideal; the alternative is a limit that is only a suggestion.

create or replace function public.enforce_support_ticket_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  -- No auth.uid() means the service role: the admin console, the cron sweep
  -- and every other server-side path. None of them is the flood this is for,
  -- and limiting them would break the support tooling itself.
  if auth.uid() is null then
    return new;
  end if;

  select count(*) into recent
    from public.support_tickets
   where user_id = auth.uid()
     and created_at > now() - interval '1 hour';

  -- auth.uid() rather than new.user_id: the insert policy already pins them
  -- equal, and counting the caller cannot be gamed by whatever is in the row.
  if recent >= 5 then
    raise exception 'too many support requests — please wait before opening another';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_support_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  select count(*) into recent
    from public.support_messages
   where sender_id = auth.uid()
     and created_at > now() - interval '1 hour';

  if recent >= 20 then
    raise exception 'too many replies — please wait before sending another';
  end if;

  return new;
end;
$$;

create trigger enforce_support_ticket_rate_limit_before_insert
  before insert on public.support_tickets
  for each row execute function public.enforce_support_ticket_rate_limit();

create trigger enforce_support_message_rate_limit_before_insert
  before insert on public.support_messages
  for each row execute function public.enforce_support_message_rate_limit();

-- support_tickets already has (user_id, created_at desc). support_messages is
-- indexed by ticket, not by sender, so the count above would be a sequential
-- scan on the one table an attacker is trying to grow.
create index support_messages_sender_recent_idx
  on public.support_messages (sender_id, created_at desc);

-- Postgres grants EXECUTE on a new function to PUBLIC, and revoking from
-- `authenticated` alone leaves that intact — the lesson of 0040. Firing a
-- trigger does not check EXECUTE on its function, so nothing here needs it.
revoke execute on function public.enforce_support_ticket_rate_limit() from public;
revoke execute on function public.enforce_support_ticket_rate_limit() from anon;
revoke execute on function public.enforce_support_ticket_rate_limit() from authenticated;
revoke execute on function public.enforce_support_message_rate_limit() from public;
revoke execute on function public.enforce_support_message_rate_limit() from anon;
revoke execute on function public.enforce_support_message_rate_limit() from authenticated;
