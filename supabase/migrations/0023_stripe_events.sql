-- Stripe Connect foundation: webhook idempotency ledger.
--
-- The existing unique constraints on payments (checkout_session_id,
-- stripe_payment_intent_id) give idempotency for the payment-confirmation
-- path today, but Connect introduces event types with no natural
-- unique-constraint backstop of their own (account.updated fires
-- repeatedly for the same account as onboarding progresses; transfer.*
-- and payout.* have no corresponding row to conditionally update against).
-- `id` is the Stripe event id itself, so a duplicate delivery is a plain
-- primary-key conflict the webhook route can check for before dispatching
-- to any handler, rather than relying on each handler being independently
-- re-entrant.
--
-- `processed_at` is left null when the row is written and set once the
-- handler completes without error, so a failed-and-retried delivery can be
-- told apart from one that already succeeded.
create table public.stripe_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Supports "recent events of this type" debugging/ops queries.
create index stripe_events_type_created_idx
  on public.stripe_events (type, created_at desc);

alter table public.stripe_events enable row level security;

-- No policies for `authenticated`/`anon`: this table has no legitimate
-- client use case at all, so RLS with zero policies denies all client
-- access by default. It is written and read exclusively by the webhook
-- route via the service-role client, which bypasses RLS entirely.
grant all on public.stripe_events to service_role;
