# RoyalPal — Stripe Test-Mode Verification Runbook

Gets from "zero real keys" to a proven destination charge → webhook →
refund → dispute, entirely in **test mode**. No real money moves.

> Every Connect behaviour in this codebase is currently proven against
> mocked SDK calls only. This runbook is what converts that into evidence.

**Pinned Stripe version:** `2026-06-24.dahlia` · SDK `22.3.2`
**Shared account warning:** this Stripe account is shared with a sibling
product (Lingora). Everything below stays in **test mode**, and RoyalPal
objects are isolated by the `app=royalpal` metadata tag, not by account.

---

## Phase 0 — Apply the outstanding migrations FIRST

Both `0024` and `0025` are written but **not applied**. The webhook
handlers write columns that do not exist yet, so every payout/dispute
event would fail until this is done. See `docs/PENDING_MIGRATIONS.sql`.

`DONE` when: `select transfer_status, platform_fee_bps from ...` runs
without error.

---

## Phase 1 — Environment

Fill these in `.env.local` (test-mode values only — all start `sk_test_` /
`pk_test_`). Get them from **Stripe Dashboard → Developers → API keys**
with the **"Test mode" toggle ON**.

| Var                                  | Where from                            | Notes                         |
| ------------------------------------ | ------------------------------------- | ----------------------------- |
| `STRIPE_SECRET_KEY`                  | Dashboard → API keys                  | must start `sk_test_`         |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | same                                  | must start `pk_test_`         |
| `STRIPE_WEBHOOK_SECRET`              | printed by `stripe listen` in Phase 3 | `whsec_…`                     |
| `NEXT_PUBLIC_APP_URL`                | `http://localhost:3000`               | used for Checkout return URLs |
| `PLATFORM_FEE_BPS`                   | optional                              | omit to use the 10% default   |

**Confirm Connect is enabled:** Dashboard → **Connect** → if you see a
"Get started" prompt, Connect has never been activated. Activate it and
choose **Express**. Nothing below works until Connect is on.

`BLOCKED` until: the three Stripe keys are non-empty.
**I cannot do this step — do not paste keys into chat; put them in
`.env.local` directly.**

---

## Phase 2 — Create a test Express account

Do this through the app, not the dashboard — the point is to prove
**our** onboarding code works.

```bash
npm run dev
```

1. Sign in as a tutor, ensure the profile has a **country** set.
2. Go to `/tutor/payouts` → **Connect with Stripe**.
3. Stripe's test onboarding accepts canned values:
   - Phone `000 000 0000`, email anything
   - **Test bank account:** routing `110000000`, account `000123456789`
   - SSN / ID: `000000000`
   - Address: use Stripe's "test address" autofill
4. You land back on `/tutor/payouts?connect=return`.

**Expected:** status shows **"pending"**, not "active". That is correct —
`stripe_charges_enabled` is flipped only by the `account.updated` webhook,
which is not listening yet. It goes active in Phase 3.

Verify the account exists and is ours:

```bash
stripe accounts list --limit 1
```

Confirm `metadata.app == "royalpal"` and `metadata.tutor_id` matches.

---

## Phase 3 — Webhook endpoint

**Local (fastest — no deployment needed):**

```bash
stripe login
```

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe --events checkout.session.completed,checkout.session.expired,payment_intent.succeeded,payment_intent.payment_failed,account.updated,charge.refunded,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,transfer.created,transfer.reversed
```

Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`, then **restart
`npm run dev`** (env is read at boot).

> The `--events` list is exactly the eleven the route handles. Every one
> exists in the pinned SDK — verified against `Events.d.ts`.
> `transfer.failed` is deliberately absent: **it does not exist** in this
> API version.

Now re-trigger the account sync so the tutor goes active:

```bash
stripe trigger account.updated
```

Better: make a trivial edit in the Express dashboard, which emits a real
`account.updated` for your actual account.

`DONE` when: `/tutor/payouts` shows **"Connected"** and
`select stripe_charges_enabled from tutor_profiles where id = '<tutor>'`
is `true`.

---

## Phase 4 — The destination charge (the core proof)

1. As a **student**, book a **standard** lesson with that tutor.
2. Pay with test card **`4242 4242 4242 4242`**, any future expiry, any CVC.

### Verify — application fee actually moved

```bash
stripe payment_intents list --limit 1
```

Check on the PaymentIntent:

- `application_fee_amount` == 10% of the price (e.g. `500` on `5000`)
- `transfer_data.destination` == the tutor's `acct_…`
- `transfer_group` == `royalpal_booking_<bookingId>`
- `metadata.app` == `royalpal`

```bash
stripe balance_transactions list --limit 5
```

Expect a `payment` (platform, net of fee) **and** a `transfer` to the
connected account.

### Verify — the ledger

```sql
select status, transfer_status, stripe_transfer_id, stripe_payment_intent_id
from payments where booking_id = '<bookingId>';
```

Expect `status='succeeded'` **and** `transfer_status='paid'`.
`transfer_status='paid'` is the Milestone 2.8 proof — if it is null, the
`transfer.created` assumption in the design was wrong and must be
revisited (see the caveat flagged when 2.8 was proposed).

### Verify — idempotency ledger

```sql
select id, type, processed_at from stripe_events order by created_at desc limit 10;
```

Every row must have a non-null `processed_at`. Then replay one:

```bash
stripe events resend <evt_id>
```

The row's `processed_at` must **not** change, no duplicate `payments` row
appears, and the app log shows `duplicate event skipped`.

---

## Phase 5 — Refund (with transfer reversal)

Use the app: **Admin → Payments → Refund** on that booking.

```bash
stripe refunds list --limit 1
```

Confirm `reverse_transfer` took effect — the connected account's balance
should drop back. Then:

```sql
select status, transfer_status, transfer_status_reason from payments where booking_id = '<id>';
```

Expect `status='refunded'`, `transfer_status='reversed'`,
`transfer_status_reason='refund'`.

**Critically: no admin alert should fire.** A refund-caused reversal is
expected and is recorded silently — if you get an alert, the
expected-vs-unexpected branch is wrong.

---

## Phase 6 — Dispute

Book + pay a **second** lesson, then pay with the dispute-triggering test
card:

**`4000 0000 0000 0259`** — creates a charge that is disputed as
fraudulent shortly after settling.

```bash
stripe disputes list --limit 1
```

```sql
select stripe_dispute_id, dispute_status, transfer_status from payments where booking_id = '<id2>';
```

Expect the dispute id recorded and `dispute_status` set.

**Verify the tutor was NOT touched:** `transfer_status` must still be
`'paid'` — no reversal, and the tutor must have received **no**
notification. Every admin should have received one.

Then close it out (test mode lets you force an outcome):

```bash
stripe disputes close <dp_id>
```

`dispute_status` must update, and admins must be alerted **exactly once**
on the terminal outcome.

---

## Done criteria

| #   | Proof                                                                                  |
| --- | -------------------------------------------------------------------------------------- |
| 1   | `application_fee_amount` + `transfer_data.destination` present on a real PaymentIntent |
| 2   | `transfer_group` == `royalpal_booking_<id>` on the real Transfer                       |
| 3   | `payments.transfer_status = 'paid'` after a real charge                                |
| 4   | Replayed event does not double-process                                                 |
| 5   | Refund reverses the transfer; no admin alert                                           |
| 6   | Dispute recorded; tutor untouched; admins alerted once                                 |

Only when all six pass is the Connect implementation **verified** rather
than merely tested.
