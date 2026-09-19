# RoyalPal — where it actually stands

Written to be checked, not to reassure. Every "done" below means a code path
that was read end to end or exercised by a test; everything that has never run
against a real dependency is in the last section, by name.

Last updated: 19 September 2026 · branch `claude/royalpal-wa6nzy`

---

## The one-line answer

RoyalPal is a complete marketplace on **web, iOS and Android** — signup through
search, booking, payment hand-off, lessons, cancellation, rescheduling,
reviews, messaging, support and admin — built on one backend that both clients
reach through the same Server Actions.

**It cannot take a payment**, because Stripe is intentionally unconfigured.
Nothing else blocks launch that is inside this repository's control.

---

## What is built

| Area                           | Web | iOS / Android | Notes                                                                        |
| ------------------------------ | --- | ------------- | ---------------------------------------------------------------------------- |
| Sign up, sign in, reset        | ✅  | ✅            | Age gate (18+) enforced inside the `auth.users` insert, not just in the form |
| Search and tutor profiles      | ✅  | ✅            | Subject, language, price, country; server-side paging                        |
| Availability                   | ✅  | ✅            | Weekly template editable on both; date exceptions web-only                   |
| Booking and slot validation    | ✅  | ✅            | Price derived server-side; overlap prevented by a GiST exclusion constraint  |
| Payment                        | ⚠️  | ⚠️            | Architecture complete, keys absent — see below                               |
| Cancellation and refund policy | ✅  | ✅            | One pure function; 24-hour rule; every path records which rule fired         |
| Rescheduling                   | ✅  | ✅            | `SECURITY DEFINER` RPC, audited, max 3 per booking                           |
| Lesson lifecycle               | ✅  | ✅            | Cron completes finished lessons and releases unpaid holds                    |
| Reviews                        | ✅  | ✅            | Only after a completed, paid lesson; content immutable, even for admins      |
| Messaging                      | ✅  | ✅            | One conversation per booking; only `read_at` is mutable                      |
| Notifications                  | ✅  | ✅            | In-app always; email and push fan out per-category                           |
| Favourites                     | ✅  | ✅            |                                                                              |
| Support and safeguarding       | ✅  | ✅            | Suspended users can still reach support to appeal                            |
| Admin console                  | ✅  | —             | Web only by design                                                           |
| Account deletion               | ✅  | web link      | 14-day grace; financial records kept, PII scrubbed                           |

### Security posture

- Row Level Security on every table, exercised as each actor (anonymous,
  student, tutor, admin, service role) against a real Postgres in CI.
- Privileged columns — role, status, price, Stripe state, ratings — are locked
  by triggers, so a compromised client cannot write them even with a valid
  session.
- Rate limiting in Postgres; **fails open** by design, loudly logged.
- Cron auth **fails closed**: no secret, no run.
- Mobile bundles hold only the Supabase URL and anon key. Enforced on every
  push by `mobile/scripts/check-bundle-secrets.mjs` reading the real Hermes
  bytecode, not asserted in a comment.

### Quality gates (all green)

541 unit, domain and database tests under `TZ=UTC` and `TZ=America/New_York` ·
44 browser assertions across a desktop and a phone viewport · typecheck, lint,
format and build on the web app · typecheck and a real Metro bundle for both
mobile platforms · a secret scan on each bundle. CI runs all of it in three
jobs on every push.

---

## What is NOT done

### 1. Stripe — deliberate, and the only launch blocker in code

`docs/STRIPE_STATUS.md` and `docs/STRIPE_TEST_MODE_VERIFICATION.md` hold the
detail. Summary: destination charges, Connect Express onboarding, the webhook
ledger, refunds, transfer reversal and dispute handling are all implemented and
unit-tested **against mocked SDK calls only**. No Stripe call has ever been made
with real keys, in any mode.

> **One thing to decide before launch, not after.** A _trial_ lesson is bookable
> from a tutor who has not completed Connect onboarding — a locked product
> decision recorded in `lib/actions/booking.ts`. When that happens the student
> is charged in full into the **platform's** balance with no transfer and no
> application fee, and nothing tracks that the tutor is owed. Find them with:
>
> ```sql
> select booking_id, amount_cents from payments
> where status = 'succeeded' and stripe_transfer_id is null;
> ```
>
> This is a money-correctness question, not a bug: it needs a policy answer
> (pay out manually, block trials until onboarding, or absorb it).

### 2. Twelve migrations are not applied to production

`0028`–`0039`. **Four of them remove a permission the deployed code still
uses**, so the order matters: deploy the code first, apply the migration
second, or tutor onboarding, booking creation, cancellation and signup each
break outright for everyone. `docs/MIGRATIONS.md` is the procedure.

### 3. Never run against a real dependency

- No email has ever been sent (no Resend key has existed here).
- No push has ever been delivered (needs a real EAS project id —
  `extra.eas.projectId` is a placeholder, so `getExpoPushTokenAsync` returns
  null and push is inert).
- No Google Meet link has ever been created.
- **Admin → Delivery** (`/admin/delivery`) is the page that answers all three
  the moment keys exist — it sends a real test through every channel and prints
  each provider's own error.

### 4. Store submission has not happened

Nothing has been signed, uploaded or submitted, and no Apple or Google account
exists in this environment. **Google Play publication is NOT complete.** Still
needed: EAS credentials, a real `projectId`, `apple-app-site-association` and
`assetlinks.json` served from the domain (both need a fingerprint that only
exists after a first real build), screenshots, descriptions, privacy nutrition
labels and the data-safety form.

**A public support/contact page is also still needed.** `/support` sits behind
the login wall, and a support URL that requires an account is commonly rejected
at review. It is deliberately not linked from the public footer rather than
linked to a login redirect.

### 5. Legal content needs a lawyer

Seven policy pages exist, are reachable from the footer of every public page,
and are written in plain language. **They have not been reviewed by anyone
qualified.** The minors policy (18+), the cancellation and refund terms, the
safeguarding process and the data-retention promises in the privacy policy are
each a commitment to real people under real law. Nothing here should be treated
as legal advice, and nothing here has been checked against the jurisdictions
RoyalPal will actually operate in.

### 6. Known gaps, stated rather than hidden

Avatar upload, date-specific availability exceptions and account deletion open
the web from the mobile app, and each button says so. `docs/MOBILE.md` has the
table.

---

## What a launch actually needs, in order

1. Decide the trial-lesson payout question above.
2. Get the policy pages in front of a lawyer.
3. Configure Stripe in **test mode** and work through
   `docs/STRIPE_TEST_MODE_VERIFICATION.md` until all six done-criteria pass.
4. Deploy the code, then apply migrations `0028`–`0039` in the documented
   order, then run the verification query.
5. Set `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS`, then open
   **Admin → Delivery** and send yourself a test.
6. `eas init`, a first build of each app, then the store assets and forms.
7. Seed the real subject taxonomy and create the first admin by hand.
