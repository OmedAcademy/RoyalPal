-- Milestone 2.7: transfer-failure and dispute state.
--
-- Deliberately columns on `payments` rather than a new transfers/disputes
-- table. A destination charge produces exactly one transfer and (at most)
-- one dispute per payment, so there is no one-to-many to model yet, and
-- `payments` is already the row every money question about a booking is
-- asked against. A separate ledger becomes worth it only once partial
-- refunds or split/multi-transfer payouts exist.
--
-- IMPORTANT: transfer_status is about paying the TUTOR. It is independent
-- of payments.status, which is about the STUDENT's charge. A transfer can
-- fail while status stays 'succeeded' — the student really did pay; the
-- money is simply still sitting in the platform balance. Conflating the two
-- would misreport revenue and, worse, imply a refund is owed when it isn't.
alter table public.payments
  add column stripe_transfer_id text,
  add column transfer_status text,
  add column transfer_status_reason text,
  add column stripe_dispute_id text,
  add column dispute_status text;

-- Null means "no transfer applies" (a plain platform charge, i.e. the tutor
-- had not completed Connect onboarding when the lesson was paid for).
--
-- 'reversed' covers both the expected case (our own refund, which uses
-- reverse_transfer) and the alarming one (a reversal nobody on this side
-- initiated). The two are told apart by payments.status, not by a separate
-- transfer state — see handleTransferReversed.
alter table public.payments
  add constraint payments_transfer_status_check
  check (transfer_status is null or transfer_status in ('paid', 'reversed'));

-- Stripe's own dispute lifecycle values are passed through verbatim rather
-- than mapped to a local vocabulary: they are Stripe's process, not ours,
-- and a CHECK here would start rejecting webhooks the day Stripe adds a
-- status. Left unconstrained on purpose.

-- Operational queues: "transfers that need a human" and "open disputes".
-- Partial indexes stay small — both sets should be near-empty in normal
-- operation, and are the two things nobody may ever be blind to.
create index payments_transfer_reversed_idx
  on public.payments (created_at desc)
  where transfer_status = 'reversed';

create index payments_disputed_idx
  on public.payments (created_at desc)
  where stripe_dispute_id is not null;

-- No RLS or grant changes: payments already has no client write policy and
-- these columns are written exclusively by the Stripe webhook handlers via
-- the service role.
