# Reconciliation Sweep — Design (NOT IMPLEMENTED)

**Status: proposal only. No code written. Awaiting approval.**

---

## Why this exists

Everything built in Milestones 2.1–2.8 is **event-driven**, which means it
all shares one common-mode failure: _no event, no correctness._

The idempotency ledger protects against an event arriving **twice**. Nothing
protects against an event arriving **never**:

- Stripe exhausts its retry window while our endpoint is down or 500ing
- A deploy drops in-flight deliveries
- The endpoint's event subscription list is misconfigured (an event type
  simply not selected in the dashboard)
- A handler silently returns early on a data condition nobody anticipated

Every one of those ends the same way: money moved at Stripe and our ledger
never heard. No alert fires, because the alert was carried by the event
that never came.

A reconciliation sweep is the only proposed control that **does not trust
webhooks at all**. It asks Stripe directly.

---

## Core principle

> **Read-only. Reports drift. Never moves money, never mutates the ledger.**

The sweep must never "fix" anything. A job that auto-corrects based on a
partial view is how a reconciliation bug becomes a double refund. It
produces a report; a human decides.

This also keeps it safe to run repeatedly — the safety property is
structural (it has no write path) rather than something you have to
reason about.

---

## Scope

**Window:** trailing N days, default 7, configurable. Bounded so the job
cannot become an unbounded scan as volume grows.

**What it fetches from Stripe** (all read-only list calls, all exist in
`2026-06-24.dahlia` / SDK 22.3.2):

| Stripe call             | Filter                                             | Purpose                     |
| ----------------------- | -------------------------------------------------- | --------------------------- |
| `paymentIntents.search` | `ROYALPAL_PAYMENT_SEARCH_QUERY` + created ≥ window | authoritative charge state  |
| `transfers.list`        | `created ≥ window`                                 | authoritative payout state  |
| `refunds.list`          | `created ≥ window`                                 | authoritative refund state  |
| `disputes.list`         | `created ≥ window`                                 | authoritative dispute state |

The PaymentIntent search reuses the existing
`metadata['app']:'royalpal'` query, so the shared account stays isolated —
Lingora's objects are never even fetched.

Transfers/refunds/disputes have no metadata of ours (Stripe creates them),
so they are correlated the same way the webhook handlers do it:
`transfer_group` → booking, cross-checked against `destination` →
`tutor_profiles`. **No new correlation mechanism is invented.**

---

## Drift classes detected

| #   | Class                                                     | Meaning                                         | Severity     |
| --- | --------------------------------------------------------- | ----------------------------------------------- | ------------ |
| D1  | Stripe succeeded, ledger not                              | Student charged, we never confirmed the booking | **critical** |
| D2  | Transfer exists, `transfer_status` null                   | Tutor was paid, we don't know it                | high         |
| D3  | Ledger `succeeded`, no Stripe PI                          | Ledger claims a payment Stripe has no record of | **critical** |
| D4  | Refund at Stripe, ledger not `refunded`                   | Student refunded, ledger still says paid        | **critical** |
| D5  | Dispute at Stripe, not in ledger                          | Chargeback we are blind to                      | **critical** |
| D6  | Amount mismatch                                           | `payments.amount_cents` ≠ Stripe amount         | **critical** |
| D7  | Fee mismatch                                              | `application_fee_amount` ≠ `platform_fee_cents` | high         |
| D8  | Transfer reversed, ledger says paid                       | Money left the tutor, ledger disagrees          | high         |
| D9  | Confirmed booking, connected tutor, no transfer after 48h | Payout that never happened                      | high         |

D9 is the one that most justifies the whole job: it is invisible to every
event handler, because the signal is the **absence** of an event.

D3 and D6 deserve emphasis — they are the only checks that can catch a bug
in **our own** write path rather than a missing Stripe event.

---

## Output

A structured drift report:

```
{ generatedAt, windowDays,
  checked: { paymentIntents, transfers, refunds, disputes },
  drift: [ { class: "D2", severity, bookingId, stripeId,
             expected, actual, detectedAt } ],
  summary: { critical: n, high: n } }
```

Delivery: structured log line (already have correlation-id logging) +
one admin notification **only when `critical > 0`**, using the existing
`notifyAdmins` path. A clean sweep is silent — otherwise the alert becomes
noise and gets ignored, which is the failure mode that made the
`transfer.created` handler deliberately silent too.

---

## Invocation

Three ways, same code path:

1. **Cron** — Vercel Cron or Supabase pg_cron, daily.
2. **Admin-triggered** — a button on `/admin/payments`, for on-demand use
   during an incident.
3. **CLI** — `npm run reconcile -- --days=30`, for local investigation.

Auth: cron path guarded by a shared secret header; admin path by the
existing `authorizeAdmin()`.

---

## Explicitly out of scope

- **Any auto-remediation.** No retried transfers, no ledger writes, no
  refunds. Report only.
- Backfilling history beyond the window.
- A double-entry platform ledger (`funds_withdrawn`/`funds_reinstated`
  accounting) — separate, larger decision.
- `payout.*` (the Stripe-balance → bank leg).
- Multi-currency normalisation — the report states amounts in their own
  currency rather than converting.

---

## Acceptance criteria (when implemented)

1. A booking paid at Stripe but `pending_payment` in the ledger reports D1.
2. A transfer at Stripe with null `transfer_status` reports D2.
3. A refund at Stripe with a non-refunded ledger row reports D4.
4. A dispute at Stripe absent from the ledger reports D5.
5. An amount mismatch reports D6.
6. A confirmed booking with a connected tutor and no transfer after 48h
   reports D9.
7. A fully consistent window reports **zero** drift and sends **no**
   notification.
8. Running the sweep twice produces identical output and **zero** writes —
   asserted by a fake that fails the test if any mutation is attempted.
9. Lingora's objects never appear in the report.
10. All four gates green.

Criterion 8 is the important one: it is what makes "safe to run
repeatedly" a tested property rather than a claim.

---

## Recommended sequencing

**This should NOT be built before Phase 1–6 of
`STRIPE_TEST_MODE_VERIFICATION.md` passes.**

A reconciler encodes assumptions about what Stripe returns and how our
ledger maps to it. Those assumptions are currently unverified — notably
whether `transfer.created` reaches the platform endpoint for destination
charges at all. Building a reconciler on an unverified model risks a job
that confidently reconciles against the wrong thing, which is worse than
having no reconciler: it manufactures false confidence.

**Verify first, then reconcile.**
