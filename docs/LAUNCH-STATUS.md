# RoyalPal — launch status

Built from what is already in the repository: `docs/AUDIT-BACKLOG.md`, the
migrations folder, `git log`, the test files, `docs/STATUS.md`,
`docs/MIGRATIONS.md` and `docs/deploy-0028-0041.md`. No new audit was run and
no new claim is made here that those sources do not already support.

As of **Sunday 20 September 2026**, commit `82c6739`, branch
`claude/royalpal-wa6nzy`.

---

## 1. LAUNCH READINESS

- **Written in the repository: ~90%**
- **Ready for real money in production: ~10%**

The gap is not unfinished features — it is that **nothing has ever run
anywhere but a test harness**: the production database is fifteen migrations
behind, no Stripe call has been made with real keys, and no build has been
signed or submitted.

---

## 2. BUILT

Every item below is **repo-only** unless stated otherwise. Nothing in this
list is live, because nothing has been deployed and verified in production.

🟢 1. **Web application** — Next.js 15, 46 page routes covering the full
student, tutor and admin surface. Repo-only.

🟢 2. **iOS application** — Expo SDK 57, 27 screens, TypeScript clean, Metro
bundle builds. Repo-only; never run on a device.

🟢 3. **Android application** — same codebase and bundle, builds clean.
Repo-only; never run on a device.

🟢 4. **Shared backend** — 28 API routes and 38 Server Actions; every mobile
write goes through the same Server Action the web form posts to, so business
rules have one implementation. Repo-only.

🟢 5. **Database schema** — 42 migrations, 23 tables, RLS enabled on every one.
Repo-only. **Production is on `0027`.**

🟢 6. **Authentication** — registration, login, password reset, email
verification, session handling, 18+ age gate enforced inside the `auth.users`
insert. Repo-only.

🟢 7. **Authorization** — role checks read from the caller's own database row,
never a form field; admin self-registration refused by the database. Verified
by an executed role matrix. Repo-only.

🟢 8. **Booking engine** — server-derived pricing, slot validation, and double
booking refused by a GiST exclusion constraint (proven, SQLSTATE 23P01).
Repo-only.

🟢 9. **Cancellation and rescheduling** — one pure policy function, 24-hour
rule, every path records which rule fired; reschedule capped and audited.
Repo-only.

🟢 10. **Messaging** — booking-scoped conversations, messages immutable except
`read_at`. Repo-only. Two P1 pagination defects open (MSG-1, MSG-2).

🟢 11. **Reviews** — require a completed _and paid_ lesson, one per booking,
immutable even to admins; moderation hides rather than edits. Repo-only.

🟢 12. **Notifications** — in-app always; email and push fan out per category
with user preferences. Repo-only; **push is inert** until a real EAS project id
exists (MOB-1).

🟢 13. **Support and safeguarding** — tickets and threads, append-only for
users, suspended users can still appeal. Repo-only. Five findings open.

🟢 14. **Admin console** — verification, suspension, refunds, review
moderation, support queue, statistics, audit log. Repo-only.

🟢 15. **Admin → Diagnostics** — checks database connectivity, which migrations
the connected database actually has, credentials, storage and the app's own
public pages over HTTP. Repo-only, and it is the tool that will answer "what is
actually live" on the day you deploy.

🟢 16. **Admin → Delivery** — sends a real test through every notification
channel and prints each provider's own error. Repo-only.

🟢 17. **Stripe Connect integration** — destination charges, application fee,
transfer group, all 13 webhook events, idempotency ledger, refunds, transfer
reversal, disputes. **Code complete, proven against mocked SDK calls only.**

🟢 18. **Security hardening** — three rounds, all proven by executed tests:
function-grant lockdown (0040), column-level exposure of PII and commission
data (0041), suspension enforcement and support-sender pinning (0042).
Repo-only.

🟢 19. **Test suite** — 640 tests across 41 files: unit, real-Postgres RLS and
trigger tests under PGlite, and 62 browser assertions. Green at `fb21b4b`.

🟢 20. **CI** — three jobs on every push: format/lint/typecheck/test/build, a
browser smoke suite, and a mobile job that bundles both platforms and scans the
real Hermes bytecode for server secrets.

🟢 21. **Legal pages** — seven policy pages, reachable from the footer of every
public page. Repo-only, **and unreviewed by a lawyer**.

🟢 22. **Deployment runbooks** — `docs/deploy-0028-0041.md` gives every
outstanding migration an ordering, a verification query and a rollback; all 22
verification queries were executed and all 8 stated expectations matched.

---

## 3. LEFT TO BUILD OR FIX

Most critical first.

### Deployment — nothing is live

🔴 1. **Apply migrations `0028`–`0042`** to production. Fifteen migrations.
Five are **code-first** (`0028`, `0029`, `0030`, `0039`, `0041`) and will break
the live site if applied before their code is deployed; `0041` is the worst of
those — it breaks every signed-in page and every `/api/v1` route at once.
`0038` must never be applied without `0040`. — _deployment_

🔴 2. **Deploy the application itself.** Confirm which of the two Vercel
projects is production, set every required environment variable including a
real `CRON_SECRET`, then verify with Admin → Diagnostics. — _deployment_

### P0

🔴 3. **MOB-1 — push is dead in every build.** `extra.eas.projectId` is the
all-zero placeholder, so `eas build` cannot run and `registerForPush` bails
before minting a token. The whole push subsystem is inert and nothing says so.
Needs `eas init`. — _code + deployment_

### P1 — nine open findings

🔴 4. **SEC-3** — suspending a user does not revoke their session. Migration
0042 blocks the damaging writes; the JWT still refreshes. — _code_

🔴 5. **SUP-4** — a reply to a resolved safeguarding ticket reaches nobody: it
stays resolved, the urgent queue filters it out, and it sorts to the bottom.
— _code_

🔴 6. **MSG-1** — message threads load the _oldest_ 500, so past 500 everything
newer is permanently invisible while the composer keeps accepting messages.
— _code_

🔴 7. **MSG-2** — the 101st conversation 404s, and so does any brand-new thread,
because `last_message_at = null` sorts last. — _code_

🔴 8. **MOB-2** — 20 of 23 notification types deep-link to web paths that do not
exist in the mobile router, landing users on a developer error screen. — _code_

🔴 9. **MOB-3** — `/tutor/profile` and `/tutor/payouts` collide with the dynamic
`tutor/[id]` route and produce an HTTP 500. — _code_

🔴 10. **MOB-4** — the app claims the whole domain for universal links but
neither association file is served; once served, the claim would swallow the
Stripe return URL and the password-reset link. — _code + deployment_

🔴 11. **MOB-5** — `detectSessionInUrl: false` is justified by a deep-link
handler that does not exist. — _code_

🔴 12. **MOB-6** — a 401 mid-session is a dead end; the app never signs out or
redirects. — _code_

### P2 — fifteen open findings

🔴 13. **SEC-4, SUP-2, SUP-3, SUP-6, SUP-7, MSG-3, MSG-4, REV-1, REV-2, MOB-7,
MOB-8, MOB-9, MOB-10, MOB-11, MOB-13.** Includes: any admin can delete the
audit log; clients choose a support ticket's status and queue position; support
rate limits are bypassable; no retention policy for safeguarding material; the
tutor reviews page averages the first 20 and calls it the total; the tutor
calendar reports a fetch failure as "nobody can book you". See
`docs/AUDIT-BACKLOG.md`. — _code_

### P3 — eight open findings

🔴 14. **SUP-5, MSG-5, REV-3, MOB-12, MOB-14, MOB-15, MOB-16, MOB-17.**
Cosmetic, diagnostic and latent-drift items. — _code_

### Unaudited — not clean, simply not looked at

🔴 15. **Performance, error handling, and UI/UX have never been audited.**
Three agents were killed mid-run by the session limit and returned nothing.
Unknown defect count. — _code_

### Non-code blockers

🔴 16. **Stripe live-mode verification.** `docs/STRIPE_TEST_MODE_VERIFICATION.md`
defines six done-criteria. **Zero are complete.** No Stripe call has ever been
made with real credentials in any mode. Until all six pass in test mode, then
live keys are swapped in, RoyalPal cannot take money. — _non-code_

🔴 17. **Tutor recruitment.** A marketplace with no tutors has nothing to sell.
No tutors exist. This is calendar work that runs in parallel with everything
above and is the single thing most likely to be started last. — _non-code_

🔴 18. **Cancellation and refund policy.** The code implements a 24-hour rule
and records which rule fired, but the rule itself is an engineering default,
not a business decision you have made and published. — _non-code_

🔴 19. **Legal review.** Seven policy pages, the 18+ minimum, the safeguarding
process and the data-retention promises all need a lawyer. Calendar time of
weeks, not hours, and it does not start until someone is instructed. — _non-code_

🔴 20. **Trial-lesson payout decision.** A trial is bookable from a tutor who
has not finished Connect onboarding; the student is charged in full into the
platform balance with no transfer and no record that the tutor is owed. Needs a
founder decision. — _non-code_

🔴 21. **Store submission.** No Apple or Google account exists. Needs EAS
credentials, first builds, `assetlinks.json` and
`apple-app-site-association`, screenshots, descriptions, privacy labels and the
data-safety form. — _non-code_

---

## 4. PACE PROJECTION

**From `git log`, last 30 days:**

| Date       | Commits |
| ---------- | ------- |
| 2026-09-10 | 5       |
| 2026-09-11 | 1       |
| 2026-09-13 | 4       |
| 2026-09-16 | 1       |
| 2026-09-19 | 22      |
| 2026-09-20 | 3       |

**36 commits across 6 working days in 30 days.**

That average is misleading in both directions. 25 of the 36 commits land on two
consecutive days — a single long AI-assisted run — while the other four working
days produced 11 between them. The real cadence is **roughly 1.4 working days
per week**.

At 2 hours per working day, that is **about 12 hours a month**.

**Remaining work, estimated from the backlog:**

| Scope                                               | Estimate  |
| --------------------------------------------------- | --------- |
| P0 + P1 (10 findings, each needing a test)          | ~30 h     |
| Re-audit and fix performance, error handling, UI/UX | ~15 h     |
| Apply migrations and verify in production           | ~4 h      |
| Stripe test-mode: all six criteria                  | ~8 h      |
| **Private-beta minimum**                            | **~57 h** |
| P2 + P3 (23 findings)                               | ~24 h     |
| EAS, store assets, submission                       | ~20 h     |
| **Public-launch additional**                        | **~44 h** |

**Projection at the current pace (12 h/month):**

- Private beta: **mid-February 2027**
- Public launch: **mid-June 2027**

**Projection at 2 hours every day (≈60 h/month):**

- Private beta: **late October 2026**
- Public launch: **mid-December 2026**

### Plainly: the current pace cannot reach a private beta in November 2026.

Six working days a month gets you there in February. Reaching November requires
roughly five times the current cadence — close to two hours _every_ day, not
two hours on the days you happen to work.

**Biggest risk to the private-beta date:** not your hours — **the weekly Claude
usage allowance**. This week it was exhausted mid-audit, killing three of six
agents and leaving three areas unexamined. The binding constraint on this
project is now tokens per week, not time per day, and no amount of discipline
about the latter fixes the former.

**Biggest risk to the public-launch date:** **tutor recruitment and legal
review**, because neither is code and neither can be compressed by working
harder on the code. Both take calendar weeks and neither has started. A perfect
codebase with no tutors and unreviewed terms cannot launch.

---

## 5. THE ONE NEXT ACTION

**Deploy the current code to production and apply migrations `0028`–`0042` in
the documented order, then open Admin → Diagnostics and read what it says.**

Everything else on this list is guesswork until something is live. You have
fifteen migrations, a runbook whose queries have all been executed, and a
diagnostics page built specifically to tell you what actually landed — and you
have never once seen this system run outside a test harness.
