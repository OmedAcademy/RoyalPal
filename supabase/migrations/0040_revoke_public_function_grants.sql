-- Two SECURITY DEFINER functions are reachable by clients that should never
-- be able to call them. Both were believed to be locked already.
--
-- WHY THE EXISTING INTENT DID NOT HOLD
-- Postgres grants EXECUTE on every newly created function to PUBLIC by
-- default. `anon` and `authenticated` inherit it, and PostgREST publishes any
-- function they can execute at /rest/v1/rpc/<name> — reachable with the anon
-- key, which ships in the web bundle and in both mobile app binaries.
-- Saying nothing about a grant is therefore the same as granting it to
-- everyone, and 0038's comment ("Not granted to authenticated: every call
-- goes through the service role") described an intention rather than a state.
--
-- 1. consume_rate_limit  — the serious one.
--    Callable by anon. SECURITY DEFINER, so it writes to rate_limits despite
--    that table having RLS with zero policies. The key is derived in
--    lib/rate-limit/limiter.ts as `<policy>:<sha256(identifier)[0:40]>` with
--    no salt, so anyone who knows a victim's email address can compute their
--    `login`, `signup` and `passwordReset` keys, and anyone who can read a
--    tutor's public profile URL has the user id behind their `createBooking`,
--    `cancelBooking` and `rescheduleBooking` keys.
--    Six unauthenticated calls then lock that person out of signing in, and
--    repeating them holds the lockout open indefinitely. The same call with
--    an arbitrary p_key also writes unbounded rows into rate_limits.
--    Proven in tests/db/function-grants.test.ts, which fails without the
--    revoke below.
--
-- 2. reschedule_booking  — granted to authenticated explicitly, in 0034, on
--    the reasoning that the function does its own authorization. It does, and
--    authorization was never the only thing protecting a reschedule. Four
--    rules live in lib/actions/booking.ts and nowhere else: the three-move
--    cap (which the function takes as a CALLER-SUPPLIED parameter, so
--    p_max_reschedules => 9999 removes it), the 24-hour minimum notice that
--    stops rescheduling being used as a cancellation that escapes the refund
--    policy, the "must be one of the tutor's open slots" check, and the rate
--    limit. Not cross-tenant — the caller must already be a participant, and
--    the GiST exclusion constraint still prevents a double booking — but a
--    business-rule bypass all the same.
--
-- Neither function loses a capability anything was using: the application has
-- only ever called both through the service role.
--
-- PUBLIC is revoked first and is the part that does the work; revoking from
-- anon and authenticated alone leaves the privilege in place through PUBLIC.

revoke execute on function public.consume_rate_limit(text, integer, integer) from public;
revoke execute on function public.consume_rate_limit(text, integer, integer) from anon;
revoke execute on function public.consume_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

revoke execute on function public.reschedule_booking(uuid, timestamptz, text, integer) from public;
revoke execute on function public.reschedule_booking(uuid, timestamptz, text, integer) from anon;
revoke execute on function public.reschedule_booking(uuid, timestamptz, text, integer)
  from authenticated;
grant execute on function public.reschedule_booking(uuid, timestamptz, text, integer)
  to service_role;

-- is_admin() stays callable by anon and authenticated, deliberately: every RLS
-- policy in this schema calls it, and a policy runs as the querying role. It
-- reads only the caller's OWN profile row and returns a boolean, so exposing
-- it tells a caller nothing they cannot already read about themselves.
