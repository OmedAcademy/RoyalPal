# Stripe Connect — where it stands

**Read this before touching anything payment-related.**

## The one-line version

Stripe Connect Express is **code-complete and unit-tested, and has never
executed a single real Stripe call.** Those are different claims and this
document keeps them apart.

## What is blocking

Exactly three things, all requiring a human with dashboard access:

| #   | Blocker                                                                                            | Who      |
| --- | -------------------------------------------------------------------------------------------------- | -------- |
| 1   | Apply the outstanding migrations (0028-0039) — see `docs/MIGRATIONS.md`, and deploy the code FIRST | operator |
| 2   | Put test-mode keys in `.env.local` (`sk_test_` / `pk_test_`)                                       | operator |
| 3   | Enable Connect **Express** in the Stripe Dashboard, Test mode                                      | operator |

Then follow `docs/STRIPE_TEST_MODE_VERIFICATION.md` end to end.

Migrations `0001`–`0027` **are** applied remotely; `0027`'s trigger check has
not been run there yet. `0028` through `0039` are **not** — twelve of them, and
four remove a permission the currently-deployed code still uses, so the order
and the timing both matter. `docs/MIGRATIONS.md` is the procedure.

## Behaviour with no keys configured (today's state)

The app is fully usable; only payment paths decline, and they say why:

| Path                                            | Behaviour                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Browsing, profiles, search, reviews, dashboards | Unaffected                                                                 |
| `createBooking`                                 | Refuses **before inserting** — no orphan `pending_payment` row to clean up |
| `retryBookingPayment`                           | Refuses with a clear message                                               |
| `cancelBooking`                                 | **Works** — cancellation touches no Stripe                                 |
| Tutor onboarding / dashboard link               | Refuses with "Payouts aren't available yet"                                |
| Admin refund                                    | Refuses, naming configuration as the cause                                 |
| Webhook endpoint                                | `500` naming the missing key — never a `400` blaming Stripe's signature    |

That last row is the one worth remembering. A missing key used to surface as
"signature verification failed", which sends whoever is debugging it hunting
for a Stripe problem that does not exist.

## Things that will surprise you

- **`transfer.failed` does not exist** in the pinned API version
  (`2026-06-24.dahlia`, SDK 22.3.2). Verified against the SDK's own
  `Events.d.ts`. Transfer events are `created` / `reversed` / `updated`
  only, and `Transfer` carries no `failure_code`. Don't add a handler for it.
- **`transfer_group` is the only booking correlation a transfer event
  carries.** Stripe creates the Transfer itself and copies none of our
  PaymentIntent metadata onto it.
- **`charges_enabled` and `payouts_enabled` are not the same flag.** A tutor
  can be earning while bank payouts are paused. The UI says so.
- **`payout.*` are Connect events** — the connected account is on the
  _event_, not the object.
- **Disputes never touch the tutor.** No reversal, no debit, no
  notification. Who absorbs a lost dispute is an unmade business decision.
- **The default commission is 10%** (`DEFAULT_PLATFORM_FEE_BPS`), changed
  from a hardcoded 15%. Overridable per deployment (`PLATFORM_FEE_BPS`) and
  per tutor (`tutor_profiles.platform_fee_bps`). Basis points, never floats.

## What is deliberately NOT built

- Reconciliation sweep — designed in `docs/RECONCILIATION_DESIGN.md`, not
  implemented. It should be built **after** live verification, not before:
  it encodes assumptions about Stripe's behaviour that are still unproven.
- Partial refunds (full refunds only).
- `charge.dispute.funds_withdrawn` / `funds_reinstated` — platform-balance
  accounting, needs a ledger.
- Dispute evidence submission.
- Rate limiting.
