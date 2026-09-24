# Stripe — what is left for a person

The code is in place. Nothing in this repository can finish the steps below.
Do not put live keys in the repo. Do not commit `.env.local`.

Until `STRIPE_SECRET_KEY` is set, the app boots and every non-payment feature
works. Booking and retry checkout return: "Payments are not yet enabled."
They do not create a booking and they do not pretend a payment succeeded.

## When the Stripe account is approved

1. In the Stripe Dashboard, turn on Connect and use Express accounts.
2. Create a webhook endpoint pointing at `https://<production-domain>/api/webhooks/stripe`.
   Subscribe at least: `checkout.session.completed`, `checkout.session.expired`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`,
   `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`,
   `charge.dispute.closed`, `transfer.created`, `transfer.reversed`,
   `payout.paid`, `payout.failed`.
3. Put these in the Vercel project (Production), not in git:

   | Name                                 | Where it comes from                                         | Who can see it                                                               |
   | ------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
   | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | API keys                                                    | Browser. `pk_test_` until you mean to charge real cards, then `pk_live_`.    |
   | `STRIPE_SECRET_KEY`                  | API keys                                                    | Server only. `sk_test_` first. `sk_live_` only when you intend real charges. |
   | `STRIPE_WEBHOOK_SECRET`              | The webhook's signing secret                                | Server only.                                                                 |
   | `STRIPE_ROYALPAL_PRODUCT_ID`         | Optional. One Product named RoyalPal in the shared account. | Server only.                                                                 |
   | `PLATFORM_FEE_BPS`                   | Optional. Unset means 10% (1000).                           | Server only.                                                                 |

4. Redeploy so the new env vars are in the running build.
5. Follow `docs/STRIPE_TEST_MODE_VERIFICATION.md` phases 4–6 with test cards
   before anyone switches the keys to live. That runbook is still unchecked
   for a real destination charge, a refund that reverses the transfer, and a
   dispute.
6. Apply any pending database migrations (`docs/MIGRATIONS.md`) only after
   this code is what production is running. Several of them refuse the old
   client-insert booking path.
7. A tutor finishes payouts from their own dashboard: RoyalPal → Payouts →
   Stripe Connect onboarding. The app does not mark `stripe_charges_enabled`
   itself. The `account.updated` webhook does.

Lost disputes are recorded and shown to admins. They do not automatically
take the money back from the tutor. That is still a decision, not a missing
webhook.

The Stripe account is shared with Lingora. RoyalPal events are the ones
whose metadata `app` is `royalpal`. Do not point Lingora's webhook secret at
this endpoint.
