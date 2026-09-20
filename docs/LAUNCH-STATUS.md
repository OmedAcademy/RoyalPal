# LAUNCH READINESS

**Sherkam — the audit backlog is empty.** All 33 findings that were still open
at the start of this session are fixed and pushed, except two that are yours to
decide and one that needs documentation I cannot reach from here.

Every gate below was run just now, at commit `be37c2d` on branch
`claude/royalpal-wa6nzy`, and the output is what is quoted:

| Gate                             | Command                                    | Result                                        |
| -------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Unit + database suite (UTC)      | `TZ=UTC npx vitest run`                    | **57 files, 760 tests, all passing**          |
| Unit + database suite (New York) | `TZ=America/New_York npx vitest run`       | **57 files, 760 tests, all passing**          |
| Browser smoke tests              | `npx playwright test`                      | **62 passed (21.2s)**                         |
| Web typecheck                    | `npx tsc --noEmit -p tsconfig.json`        | **exit 0**                                    |
| Mobile typecheck                 | `npx tsc --noEmit -p mobile/tsconfig.json` | **exit 0**                                    |
| Lint                             | `npx eslint .`                             | **exit 0**                                    |
| Formatting                       | `npx prettier --check .`                   | **All matched files use Prettier code style** |
| Production build                 | `npm run build`                            | **compiled, every route emitted**             |

The suite grew from 640 tests to 760 this session. Both timezone runs pass, so
nothing here depends on the machine's clock being UTC.

**Nothing in this report is live.** Production is still on migration `0027`;
`0028`–`0046` are written, tested against a real Postgres, and unapplied. See
`docs/MIGRATIONS.md` for the order and the four that require the code to be
deployed first.

---

# FIXED THIS SESSION 🟢

1. **SEC-3 — suspension now ends the session.** `setUserStatus` wrote
   `profiles.status` and nothing else, so a suspended account kept a valid,
   refreshable JWT. Now revoked through GoTrue's `ban_duration`, lifted on
   reactivation so a reversible action stays reversible. `7b6c92c`
2. **SEC-4 — the admin audit log is append-only.** `0011` granted delete on
   `admin_actions` to `authenticated` and `0010`'s policy is `for all using
is_admin()`, so any admin could delete the record of their own actions — in
   the table that exists for exactly that case. Migration `0043`. `7b6c92c`
3. **MSG-1 — threads load the newest messages.** They loaded the OLDEST 500, so
   past that point a conversation looked frozen while the composer went on
   accepting messages neither party could see. Newest-first with a keyset
   cursor, and a read receipt that fires only on the newest page. `8432e9e`
4. **MSG-2 — a thread opens on its own.** `getConversation` resolved by
   scanning a list capped at 100, so the 101st thread 404'd — and so did every
   brand-new thread, because `last_message_at` is null until someone speaks and
   nulls sort last. The inbox is now paged rather than capped. `8432e9e`
5. **SUP-4 — a reply to a resolved ticket reaches an admin.** RLS blocks only
   `closed`, so a reply landed on a resolved ticket and then reached nobody:
   the urgent queue filters resolved out, and the oldest-first ordering moved
   the row DOWN. Reopens, and notifies every active admin. `6f4f3c2`
6. **MOB-2 / MOB-3 — notification links land on a real screen.** Web hrefs were
   pushed raw: most showed expo-router's _developer_ "Unmatched Route" screen,
   and `/tutor/profile` matched `tutor/[id]` and produced a 500 from a uuid
   cast. A translation map, a `+not-found` backstop, and `getTutorById` now
   returns null for a non-uuid id so the API 404s for every client. `643617f`
7. **MOB-6 — a 401 mid-session is no longer a dead end.** Every screen showed
   an error with a Retry that could not work, because the token it would retry
   with is the thing that is dead. Handled once, in `request()`: one refresh,
   one retry, then sign out — which is what routes the app to sign-in. `0f3d77f`
8. **SUP-3 — the support rate limits hold at the write boundary.** They lived
   in the Server Action, which is not the boundary; 50 tickets went in directly
   against a documented 5/hour policy. Migration `0044`. `b39f680`
9. **SUP-2 — a client supplies only its own columns.** A safeguarding ticket
   could arrive already `resolved`, or dated 2999 to sort off the queue.
   Migration `0045`. `95dbdfe`
10. **SUP-7 — an urgent ticket is visible in the product.** Escalation was a log
    line and a webhook that is dormant unless `ALERT_WEBHOOK_URL` is set.
    `openTicketCount()` had no callers at all. `95dbdfe`
11. **MSG-3 — the inbox preview is the newest message.** One capped query across
    every thread meant the busiest threads — the ones at the top — showed no
    preview at all. Migration `0046`. `6b5997c`
12. **MSG-4 — the unread badge counts your messages.** No participant predicate;
    for an ADMIN the badge counted every unread message on the platform.
    Migration `0046`. `6b5997c`
13. **REV-1 — a refusal a student can act on.** The pre-check was weaker than the
    policy, so "new row violates row-level security policy" appeared under a
    review form. `64ff4be`
14. **REV-2 — the tutor's real average, and the right of reply.** The screen
    averaged the first 20 reviews and printed it as the total; reviews 21+ had
    no reply form. `64ff4be`
15. **MOB-11 — the search box searches what it says.** "Name or subject" matched
    name and headline only. Also fixed a country filter that a headline match
    walked straight past. `a831a6c`
16. **MOB-13 — a failed request is not an empty result.** A fetch failure told a
    tutor "you haven't set any availability, so nobody can book you". `a831a6c`
17. **MOB-7, MOB-8, MOB-9, MOB-10 — four mobile defects.** Duplicate requests and
    stale responses overwriting newer ones; a frozen unread badge; buttons under
    the home indicator; Android's Done button under the gesture bar. `a831a6c`
18. **MSG-5 — database errors are readable.** Every PostgREST failure logged
    `[object Object]` — the one path designed to be opaque to users was opaque
    to operators too. `be37c2d`
19. **REV-3, MOB-17, SUP-5, MOB-12, MOB-15, MOB-16 — six smaller ones.** Zod's
    internal text shown to students; a 15-minute join window hand-copied into
    two clients; a blank support thread; an unreachable "Booked" message; a junk
    Android permission; Retry buttons on errors that cannot be retried.
    `be37c2d`

---

# STILL OPEN 🔴

1. **MOB-14 — no unsaved-changes guard on `availability/edit` or
   `profile/edit`.** Pressing back discards silently. Not attempted:
   `usePreventRemove` is not in the installed tree, `@react-navigation/*` is not
   resolvable at the top level, and `mobile/AGENTS.md` says to read the
   versioned Expo docs before writing Expo code — which I cannot reach from
   here. Guessing at that API is how a back button stops working entirely.
   `availability/edit` already tracks `dirty`; it needs only the hook.
2. **SUP-6 — no retention, review or erasure policy for safeguarding material.**
   A decision before it is code: how long it is kept, who may review it, whether
   an erasure request reaches it. A placeholder retention period would be worse
   than none. `lib/account/anonymize.ts` carries the same open question for
   accounts.
3. **A device check for MOB-7, MOB-8, MOB-9 and MOB-10.** All four are
   implemented and typecheck, but the Expo project has no test renderer, so
   nothing proves them. Adding `@testing-library/react-native` is a toolchain
   decision, not something to slip into a fix commit.
4. **Everything in this repository is unapplied.** Migrations `0028`–`0046` are
   not on production, and no code from this session is deployed.
5. **Stripe was not touched.** Out of scope by your instruction. The Stripe
   tests were run on every change that came near them and pass.

---

# NEW MIGRATIONS ADDED

All numbered after the highest existing migration, none applied anywhere.

| #      | What it does                                                                                                                                                                          | Deploy order                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `0043` | Revokes insert/update/delete on `admin_actions` from `authenticated` and `anon`, keeping SELECT.                                                                                      | Either order — every real write already goes through the service role.                                |
| `0044` | Before-insert triggers enforcing 5 tickets/hour and 20 replies/hour at the write boundary, plus a `(sender_id, created_at)` index.                                                    | Either order — the action's limiter counts attempts and refuses first.                                |
| `0045` | Revokes table-level INSERT on `support_tickets` / `support_messages` and re-grants only the columns a client supplies.                                                                | **Code first.** The old action sent no extra columns, so nothing breaks — but verify before applying. |
| `0046` | Adds `conversations.last_message_preview` with a backfill and a trigger, adds `unread_message_count()`, and narrows the UPDATE grant on `conversations` to `(status, closed_reason)`. | **Code first.** The new code reads the column and calls the function.                                 |

---

# THE ONE NEXT ACTION

**Apply `0028`–`0046` to production, in order, following `docs/MIGRATIONS.md`
and `docs/deploy-0028-0041.md` — deploying the code first where those documents
say to.**

Nothing else on this list matters until that happens. Forty-six migrations are
written and tested and production is on twenty-seven; every security fix in this
report — the audit log, suspension, the column exposure, the rate limits — is
inert until the migration behind it is live. The two remaining open items are a
policy decision and a phone, and neither blocks the deploy.
