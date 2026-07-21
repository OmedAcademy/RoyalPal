-- Under current Stripe API versions, a Checkout Session in `payment` mode
-- has NO PaymentIntent until the customer actually submits payment —
-- session.payment_intent is null at session creation. The payment-attempt
-- row written when checkout starts (lib/actions/booking.ts startCheckout)
-- therefore can't know the id yet, and the previous NOT NULL constraint
-- forced an empty-string placeholder there. Two concurrent pending
-- checkouts then collide on the UNIQUE '' value: the second row silently
-- fails to insert, and checkout.session.expired can no longer match a
-- payments row for it — leaving the abandoned booking pending_payment and
-- its slot blocked. Nullable fixes this: UNIQUE permits any number of
-- NULLs, and the webhook fills in the real id once payment succeeds.
alter table public.payments
  alter column stripe_payment_intent_id drop not null;
