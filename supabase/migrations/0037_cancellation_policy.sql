-- Cancellation policy state, and the in-flight half of a refund.
--
-- 0030 stopped a participant cancelling a paid lesson with a direct write.
-- This adds the thing that was missing on the other side of that door: a
-- record of WHAT the policy decided, so a cancellation is auditable after the
-- fact rather than being a status change with a free-text reason.
--
-- THE REFUND INVARIANT THIS PRESERVES
-- `payments.status = 'refunded'` is written in exactly one place —
-- handleChargeRefunded, from Stripe's own charge.refunded event. Nothing here
-- changes that, and nothing here may. The columns below are deliberately
-- separate from it:
--
--   refund_owed_cents      what OUR policy says the student is due. A
--                          decision, computed at cancellation time.
--   refund_requested_at    when we asked Stripe. An attempt, not an outcome.
--   stripe_refund_id       the id Stripe gave that attempt.
--   payments.status        what Stripe has CONFIRMED actually happened.
--
-- Collapsing any of these into the others is how a platform tells a student
-- their money is back when it isn't. Before this migration, a refund that was
-- requested but never confirmed (the create call succeeded, the webhook never
-- arrived) was invisible in the data — indistinguishable from one that was
-- never requested at all. That is the single worst state for a payments
-- system to be unable to see, and it is now a queryable index.

alter table public.bookings
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id),
  -- Which rule fired, recorded by name rather than recomputed later. The
  -- policy WILL change; a lesson cancelled under the old one must stay
  -- explainable under the new one.
  add column if not exists cancellation_policy text,
  add column if not exists refund_owed_cents integer;

alter table public.bookings
  drop constraint if exists bookings_refund_owed_sane;
alter table public.bookings
  add constraint bookings_refund_owed_sane
  check (
    refund_owed_cents is null
    or (refund_owed_cents >= 0 and refund_owed_cents <= price_cents)
  );

alter table public.payments
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refund_requested_by uuid references public.profiles (id),
  add column if not exists stripe_refund_id text;

-- The queue nobody may ever be blind to: money we told Stripe to send back
-- and have not had confirmation of. Partial, so it is empty in normal
-- operation and every row in it is an incident.
create index if not exists payments_refund_unconfirmed_idx
  on public.payments (refund_requested_at)
  where refund_requested_at is not null and status <> 'refunded';

create index if not exists bookings_cancelled_idx
  on public.bookings (cancelled_at desc)
  where cancelled_at is not null;

-- 0029's client column lock allows a client to write status and
-- cancellation_reason. The cancellation columns above must NOT join that
-- list — a student who could set their own refund_owed_cents would be
-- writing their own refund. They are written by cancelBooking through the
-- service role, which the lock already exempts, so this is a matter of NOT
-- widening the allowlist rather than adding a new rule. Restated here only
-- because the temptation to add them will be strong and this comment is
-- where someone will look.

-- The one genuinely new client-facing rule: cancellation_reason is writable,
-- but not rewritable. Letting a participant edit the reason after the fact
-- turns the audit trail into a draft.
create or replace function public.protect_cancellation_reason()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and old.cancellation_reason is not null
     and new.cancellation_reason is distinct from old.cancellation_reason then
    raise exception 'a cancellation reason cannot be rewritten'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_cancellation_reason
  before update on public.bookings
  for each row execute function public.protect_cancellation_reason();
