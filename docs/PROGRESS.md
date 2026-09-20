# RoyalPal — work in progress

**Read this file first.** It is the resume point: queue, status and proof for
every item. Updated after every completed fix.

Branch `claude/royalpal-wa6nzy`. Baseline verified at `b666da5`.

## Standing constraints

- **Stripe is out of scope.** Preserve all Stripe code; if a change touches it,
  keep its tests passing but change nothing.
- **Production is off limits.** No migration is ever applied to a hosted
  database, nothing is deployed, nothing pushed to main.
- **Proof standard.** A fix is done only when a test failed before it and
  passed after, and both were observed.

## Baseline (measured at b666da5, not assumed)

| Gate             | Command                         | Result               |
| ---------------- | ------------------------------- | -------------------- |
| Typecheck        | `npx tsc --noEmit`              | PASS                 |
| Lint             | `npx eslint .`                  | PASS                 |
| Format           | `npx prettier --check .`        | PASS                 |
| Web tests        | `TZ=UTC npx vitest run`         | 640 passed, 41 files |
| Mobile typecheck | `cd mobile && npx tsc --noEmit` | PASS                 |

## Phase 1 triage of docs/AUDIT-BACKLOG.md

**ALREADY FIXED** — SEC-1, SEC-2, SUP-1. Proven by
`tests/db/suspension-enforcement.test.ts` (14 tests) at `fb21b4b`.

**STILL OPEN** — the other 33. Each was re-checked against current code; the
five leading the queue were confirmed by direct inspection:

| ID    | Confirmed still open by                                                                          |
| ----- | ------------------------------------------------------------------------------------------------ |
| SEC-3 | `lib/actions/admin.ts` contains no `signOut`/`ban_duration`/`revoke`                             |
| SEC-4 | `0011_grants.sql:39` still grants `delete` on `admin_actions` to `authenticated`                 |
| MSG-1 | `lib/messaging/service.ts:213` `order(created_at, ascending: true).limit(500)`                   |
| MSG-2 | `lib/messaging/service.ts:204` resolves through `listConversations`, capped at `:88 .limit(100)` |
| SUP-4 | `lib/actions/support.ts:145` `.eq("status", "waiting_on_user")`                                  |

**NOT A REAL ISSUE** — none reclassified. The findings that were checked all
still describe the current code.

## Phase 1 inspection of the three never-audited areas

**Performance — better than feared.** Index coverage is sound: every hot filter
has one (`tutor_profiles_verification_status_idx`, `conversations_student_idx`,
`conversations_tutor_idx`, `messages_conversation_idx`, `messages_unread_idx`,
`notifications_user_unread_idx`, `bookings_tutor_id_start_at_idx`). No missing
index found on a filtered or joined column. The real performance defects are
the two already in the backlog: MSG-3 (inbox previews share one global
`limit(1000)`) and MSG-4 (unread count has no participant predicate and relies
on RLS scope, which for an admin is every message on the platform).

**Error handling.** Seven sites return a raw database or provider error to the
user: `lib/actions/admin.ts:121,181`, `review.ts:70`, `auth.ts:87,119,225`,
`booking.ts:542`. REV-1 is the reachable one. No empty catch blocks and no
unhandled rejections found.

**UI/UX states.** Web list views all have empty states via `AdminTable`.
Gaps found: `app/support/` has no `loading.tsx` while student/tutor/admin all
do; a message-less ticket renders as a blank thread in all three clients
(SUP-5); five mobile screens offer Retry on non-retryable errors (MOB-16); the
tutor calendar reports a fetch failure as "nobody can book you" (MOB-13).

---

## QUEUE

### P0 — security, data loss, auth, broken core journeys

| #   | ID                                            | Status   |
| --- | --------------------------------------------- | -------- |
| 1   | SEC-3 suspension does not end active sessions | **DONE** |
| 2   | SEC-4 admins can delete the audit log         | **DONE** |

### P1 — booking, availability, messaging, reviews, admin, mobile navigation

| #   | ID                                                           | Status   |
| --- | ------------------------------------------------------------ | -------- |
| 3   | MSG-1 threads load the oldest 500, newest invisible          | **DONE** |
| 4   | MSG-2 101st conversation and every new thread 404            | **DONE** |
| 5   | SUP-4 reply to a resolved safeguarding ticket reaches nobody | **DONE** |
| 6   | MOB-3 `/tutor/profile` collides with `tutor/[id]` → HTTP 500 | **DONE** |
| 7   | MOB-6 401 mid-session is a dead end                          | QUEUED   |
| 8   | MOB-2 20 of 23 notification types deep-link nowhere          | **DONE** |
| 9   | SUP-3 support rate limits bypassable at the write boundary   | QUEUED   |

### P2 — validation, edge cases, performance, reliability, UX states

SUP-2, SUP-6, SUP-7, MSG-3, MSG-4, REV-1, REV-2, MOB-7, MOB-8, MOB-9, MOB-10,
MOB-11, MOB-13. All QUEUED.

### P3 — polish

SUP-5, MSG-5, REV-3, MOB-12, MOB-14, MOB-15, MOB-16, MOB-17. All QUEUED.

---

## COMPLETED

### SEC-3 — suspension now ends the session · P0

- **Was wrong:** `setUserStatus` wrote `profiles.status` and nothing else, so a
  suspended account kept a valid, refreshable JWT. Migration 0042 stops it
  writing through PostgREST, but the session itself stayed alive until it
  expired.
- **Changed:** `lib/actions/admin.ts` now calls
  `auth.admin.updateUserById(userId, { ban_duration })` — `876000h` on suspend,
  `"none"` on reactivate, so a reversible action stays reversible. Best-effort
  and logged: the status column is already committed and is the source of
  truth. `tests/helpers/fake-supabase.ts` gained the GoTrue admin surface and
  records every call.
- **Proof:** `lib/actions/admin.test.ts`, 3 new tests. Observed 2 failed → 13
  passed.
- **Commit:** see below.

### SEC-4 — the audit log is append-only · P0

- **Was wrong:** `0011` granted insert/update/delete on `admin_actions` to
  `authenticated` and `0010`'s policy is `for all using is_admin()`, so any
  admin could delete the record of their own actions. Proven: rows=1.
- **Changed:** migration **0043** revokes insert/update/delete from
  `authenticated` and `anon`, keeping SELECT for the console. Every real write
  already goes through the service role via `logAction()`, so nothing the app
  does is lost.
- **Proof:** `tests/db/audit-log-integrity.test.ts`, 6 tests. Observed
  `DB_TEST_MAX_MIGRATION=42` → 3 failed; with 0043 → 6 passed.
- **Commit:** see below.

---

### MSG-1 — threads load the NEWEST messages, with a cursor for the rest · P1

- **Was wrong:** `getConversation` fetched `order(created_at, ascending: true).limit(500)`
  — the OLDEST 500. Past 500 messages the thread appeared frozen in the past
  while the composer went on accepting messages neither party could see.
- **Changed:** fetch newest-first with `limit(pageSize + 1)`, reverse for
  display, and return `hasMore` plus a keyset `nextCursor`. Page size 50.
  Keyset rather than offset because a thread grows at the end while it is being
  read. Web gets a "Load earlier messages" link; mobile gets a button that
  prepends pages and no longer snaps to the bottom once you are in history.
- **Also fixed here:** a read receipt now fires only on the newest page.
  Marking a thread read while the reader is down in its history told the other
  person something untrue.

### MSG-2 — a thread opens on its own, not by scanning a capped list · P1

- **Was wrong:** `getConversation` resolved through `listConversations`, capped
  at `.limit(100)`. The 101st thread 404'd. Worse, a brand-new thread has
  `last_message_at = null` and nulls sort last — so the thread for a lesson
  booked one second ago was the single least reachable thread in the inbox.
- **Changed:** query the conversation directly by id, with an explicit
  participant check beside the RLS one. Separately, `listConversations` is now
  paged (`range` + exact count, 25/page) instead of capped, and web, the JSON
  API and mobile all carry prev/next.
- **Proof:** `lib/messaging/service.test.ts`, 8 tests. Observed 7 failed → 8
  passed. `tests/db/messaging-authorization.test.ts` (14) still passes.
- **Commit:** this one.

### SUP-4 — a reply to a resolved ticket reaches an admin · P1

- **Was wrong:** RLS blocks a message only on a `closed` ticket, so a reply
  landed on a `resolved` one and then reached nobody. The ticket stayed
  `resolved`; the admin queue's urgent lift explicitly excludes `resolved` and
  `closed`; and the queue sorts oldest-activity-first, so touching
  `last_message_at` moved the row DOWN. Three reasonable decisions composing
  into a safeguarding report nobody sees.
- **Changed:** `replyToTicket` now reopens on `.in("status",
["waiting_on_user", "resolved"])` — conditional in the statement, so an admin
  picking the ticket up at the same instant is not overwritten. `closed` is
  absent because the insert cannot reach it. Added
  `notifyAdminsOfTicketActivity()`: every ACTIVE admin gets a
  `support_ticket_activity` notification deep-linking to `/admin/support/<id>`,
  on a reopen or on any reply to an urgent category regardless of status.
  The `support` category is not in `OPTIONAL_CATEGORIES`, so it cannot be
  switched off.
- **Proof:** `lib/actions/support.test.ts`, 8 tests. Observed 5 failed → 8
  passed.
- **Commit:** this one.

### MOB-2 + MOB-3 — notification links land on a real screen · P1

- **Was wrong:** notification hrefs are written once, server-side, for the WEB
  router, and the app pushed them raw. Two failures. Quiet: `/student/bookings`
  matches nothing and expo-router shows its "Unmatched Route" DEVELOPER screen
  in a shipped build. Loud: `/tutor/profile` and `/tutor/payouts` DO match —
  against `tutor/[id]`, with id="profile" — so the screen asked the API for
  tutor "profile", Postgres refused the uuid cast, and the person got a 500 on
  a screen that looked plausible on the way in.
- **Changed:** `mobile/lib/routes.ts` — `toMobileRoute(href, role)`, a data
  table rather than branching in a screen, so both places that navigate from a
  server href give the same answer. `null` means "no such destination here" and
  the caller does not navigate. Wired into the push-tap handler in
  `_layout.tsx` (held until the role is known — a cold start from a tap beats
  `/api/v1/me`) and into the in-app list. Added `mobile/app/+not-found.tsx` as
  the backstop. Web side: `getTutorById` returns null for a non-uuid id before
  querying, so the API 404s instead of 500ing for every client, not just this
  one.
- **Proof:** `mobile/lib/routes.test.ts`, 12 tests, which read the app's real
  routes off the filesystem rather than trusting a hand-written list. Observed
  9 failed against today's behaviour (the identity mapping) → 12 passed.
  `lib/supabase/tutor-search.test.ts`, 4 tests: 3 failed → 4 passed.
- **Note:** `vitest.config.ts` now also includes `mobile/lib/**/*.test.ts`.
  Those modules import by relative path, never through `@`, because that alias
  resolves to the web root here and to the mobile root inside Expo.
- **Commit:** this one.

## NEEDS SHERKAM

Cannot be fixed here. Not faked with placeholders.

- **MOB-1 — Expo EAS project ID.** `extra.eas.projectId` is the all-zero
  placeholder, so `eas build` cannot run and push is silently dead in every
  build. Requires `eas init` against your Expo account.
- **Apple and Google developer accounts** — no build can be signed, uploaded or
  submitted without them.
- **Legal review** — seven policy pages, the 18+ minimum, the safeguarding
  process and the data-retention claims.
- **Cancellation and refund policy** — the 24-hour rule in code is an
  engineering default, not a business decision you have published.
- **Trial-lesson payout decision** — a trial is bookable from a tutor without
  Connect onboarding; the student is charged and nothing records that the tutor
  is owed. (Stripe itself is out of scope; this is the business rule.)
- **Tutor recruitment** — no tutors exist.
- **Deployment** — applying migrations `0028`–`0042` and deploying. Off limits
  to me by rule.
