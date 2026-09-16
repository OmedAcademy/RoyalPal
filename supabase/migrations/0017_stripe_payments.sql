-- M8/M9: Stripe Checkout integration.
--
-- 'expired' is distinct from 'failed': 'failed' means Stripe actively
-- declined a payment attempt (payment_intent.payment_failed), 'expired'
-- means the student abandoned the Checkout Session before paying
-- (checkout.session.expired) — both free up the booking's slot, but they
-- are different operational signals worth telling apart in the data.
alter type public.payment_status add value if not exists 'expired';

-- checkout_session_id lets the webhook look up/upsert the payment row by
-- either the Checkout Session or the PaymentIntent, since
-- checkout.session.completed and payment_intent.succeeded/failed each
-- carry a different one of the two ids. paid_at records when the payment
-- actually succeeded, separate from created_at (when checkout started).
alter table public.payments
  add column checkout_session_id text,
  add column paid_at timestamptz;

-- Each Checkout Session maps to exactly one payment attempt record, and
-- this doubles as the upsert target for `on conflict` in the webhook
-- handler.
alter table public.payments
  add constraint payments_checkout_session_id_key unique (checkout_session_id);
