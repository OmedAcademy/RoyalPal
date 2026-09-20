# RoyalPal — multi-agent audit backlog

Findings from the orchestrated audit of 20 September 2026, against commit
`a5e620d`. Every entry below was **proven by something that was run**, not
inferred from reading code. Two are fixed in `fb21b4b`; the rest are OPEN.

Severity: **P0** catastrophic/security/data-loss · **P1** critical feature or
serious security · **P2** important · **P3** minor.

## Coverage — what was and was not audited

| Area                                   | Agent          | Outcome                                                     |
| -------------------------------------- | -------------- | ----------------------------------------------------------- |
| Support & safeguarding                 | delivered      | 7 findings                                                  |
| Messaging & reviews (action layer)     | delivered      | 8 findings                                                  |
| Mobile (contracts, deep links, config) | delivered      | 17 findings                                                 |
| Authorization / RBAC / suspension      | orchestrator   | 3 findings                                                  |
| Performance & query patterns           | **INCOMPLETE** | agent hit the session rate limit mid-run; measurements lost |
| Error handling & edge cases            | **INCOMPLETE** | agent hit the session rate limit before producing output    |
| UI/UX & accessibility                  | **INCOMPLETE** | agent hit the session rate limit mid-run                    |

Those three areas are **unaudited**, not clean. They must be re-run.

Structurally blocked in this environment, not testable at any effort: iOS and
Android runtime (no simulator, emulator or device), live Stripe (no keys),
production deployment (no access), store submission (no Apple/Google account).

---

## FIXED in fb21b4b

| ID    | Sev    | Finding                                                                                                                                                                                                                                                                                |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-1 | **P0** | Suspension enforced only in application code. A suspended account kept a valid JWT and could send messages, leave reviews, save favourites and edit its profile straight through PostgREST. Fixed by `is_active()` on the messages/reviews/favorites insert policies (migration 0042). |
| SEC-2 | **P1** | A suspended tutor stayed in search and stayed bookable; `createBooking` never checked account status. Fixed in `tutor-search.ts` and `booking.ts`.                                                                                                                                     |
| SUP-1 | **P1** | `support_messages.from_admin` was client-supplied, so a user could post a message rendered as "RoyalPal Support" inside safeguarding evidence. Fixed by pinning `from_admin = is_admin()` (migration 0042).                                                                            |

---

## OPEN — P1

| ID    | Area      | Finding                                                                                                                                                                                                                                                          | Fix sketch                                                                                              |
| ----- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| SEC-3 | Auth      | Suspending a user does not revoke their session. `setUserStatus` writes the column only, so the JWT stays refreshable. 0042 blocks the damaging writes, but the session should die too.                                                                          | Ban/revoke via the GoTrue admin API on suspend. Needs a product decision on ban semantics.              |
| SUP-4 | Support   | A reply to a **resolved** safeguarding ticket produces no signal anywhere: it stays `resolved`, the urgent queue filters `resolved` out, `last_message_at` sorts it to the bottom, and no admin notification exists. A new safeguarding message can land unseen. | `.in("status", ["waiting_on_user", "resolved"])` in `replyToTicket`, plus an admin-facing notification. |
| MSG-1 | Messaging | Threads load `order(created_at, asc).limit(500)` — the **oldest** 500. Past 500 messages, everything newer is permanently invisible while the composer keeps accepting messages.                                                                                 | Fetch descending, reverse for display, return a cursor.                                                 |
| MSG-2 | Messaging | `getConversation` resolves through `listConversations`, which is capped at 100. The 101st thread 404s. Worse: a brand-new thread has `last_message_at = null` and sorts **last**, so the thread for a lesson just booked is unreachable.                         | Query the conversation directly by id; RLS already hides non-participants.                              |
| MOB-2 | Mobile    | 20 of 23 notification types deep-link to **web** paths that do not exist in the mobile router, landing users on expo-router's "Unmatched Route" developer screen in production.                                                                                  | A `toMobileRoute()` translation map, plus a `+not-found.tsx`.                                           |
| MOB-3 | Mobile    | `/tutor/profile` and `/tutor/payouts` collide with the dynamic `tutor/[id]` route, producing `GET /api/v1/tutors/profile` → uuid cast error → **HTTP 500**. Worse than unmatched: a plausible screen that fails.                                                 | Same map; also make `getTutorById` return null on a malformed id so the API 404s.                       |
| MOB-4 | Mobile    | The app claims the whole `royalpal.app` domain for universal/app links, but neither association file is served — so links silently never fire; and once served, the domain-wide claim would capture the Stripe return URL and the password-reset link.           | Serve both files **and** scope the claim with path prefixes/excludes first.                             |
| MOB-5 | Mobile    | `detectSessionInUrl: false` is justified by a comment pointing at a deep-link handler in `_layout.tsx` that does not exist. `expo-linking` is a dependency imported by zero files.                                                                               | Implement the handler or delete the claim and the dependency.                                           |
| MOB-6 | Mobile    | `ApiError.isAuthFailure` is consulted only at bootstrap. A 401 mid-session renders a dead-end error with a Retry that can never work; the app never signs out or redirects.                                                                                      | Handle 401 centrally in `lib/api.ts`'s `request()` — one change fixes every screen.                     |

## OPEN — P2

| ID     | Area      | Finding                                                                                                                                                                                                                             |
| ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-4  | Admin     | Any admin can `DELETE FROM admin_actions` — the audit log of their own privileged actions. Proven: `rows=1`. Fix: `revoke insert, update, delete on admin_actions from authenticated` (writes already go through the service role). |
| SUP-2  | Support   | `support_tickets_insert_own` pins only `user_id`, so a client chooses `status`, `assigned_admin_id` and `last_message_at` at insert — a safeguarding ticket can be created already `resolved`, or dated 2999 to sort off the queue. |
| SUP-3  | Support   | Rate limits live in the Server Action only. 50 tickets inserted directly against a documented 5/hour policy — a flood path into the safeguarding queue.                                                                             |
| SUP-6  | Support   | No retention, review or erasure behaviour exists for safeguarding material. Policy decision first, then code.                                                                                                                       |
| SUP-7  | Support   | No in-app admin signal for an urgent ticket: escalation is a log line plus a webhook that is dormant unless `ALERT_WEBHOOK_URL` is set. `openTicketCount()` is dead code — the badge was never wired.                               |
| MSG-3  | Messaging | Inbox previews share one global `.limit(1000)` ordered ascending, so past ~1000 messages the most recently active threads show **no** preview and old ones show stale text.                                                         |
| MSG-4  | Messaging | `unreadMessageCount()` has no participant predicate and relies on RLS scope — which for an **admin** is every message on the platform. Also an unindexed `count(*)` on every authenticated page render.                             |
| REV-1  | Reviews   | `createReview` returns `error.message` verbatim, and its pre-check is weaker than the RLS policy, so a real refusal shows the user raw Postgres text.                                                                               |
| REV-2  | Reviews   | `/tutor/reviews` computes its average over the first 20 reviews and presents it as the total, contradicting `avg_rating`; reviews 21+ have no reply form, so the documented right of reply is unavailable.                          |
| MOB-7  | Mobile    | `useApi` fires two requests per mount (`useEffect` + `useFocusEffect`) and has no staleness guard — an older response can overwrite a newer one on the paginated search screen.                                                     |
| MOB-8  | Mobile    | The unread tab badge is frozen for the session; `me` is fetched once and `refresh()` has exactly one caller (profile save).                                                                                                         |
| MOB-9  | Mobile    | `Screen` hard-codes `edges={["top","left","right"]}` with no override, despite its own comment promising one — every stack-pushed screen renders its last button under the home indicator.                                          |
| MOB-10 | Android   | The `Chooser` modal relies on `presentationStyle="pageSheet"` (iOS-only), so on Android its "Done" button sits under the gesture bar.                                                                                               |
| MOB-11 | Mobile    | Search placeholder promises "Name or subject"; `q` matches only `full_name` and `headline`. Subject search silently returns nothing.                                                                                                |
| MOB-13 | Mobile    | The tutor calendar reports a **fetch failure** as "you haven't set any availability — nobody can book you", the most alarming possible message. `availability.error` is never read.                                                 |

## OPEN — P3

| ID     | Finding                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SUP-5  | A message-less ticket (the create path tolerates a failed second write) renders as a blank thread in all three clients — no empty state anywhere.                                       |
| MSG-5  | `serializeError` does `String(err)` on non-Error objects, so every PostgREST error logs as `[object Object]` — the one path designed to be opaque to users is also opaque to operators. |
| REV-3  | Rating validation is enforced but only `min` has written copy; `6` and `3.7` surface zod's internal text to the user.                                                                   |
| MOB-12 | A "free booking" success branch in `book/[id].tsx` is unreachable — `createBooking` always redirects to checkout.                                                                       |
| MOB-14 | No unsaved-changes guard on `availability/edit` or `profile/edit`; back discards silently. `availability/edit` already tracks `dirty` and uses it only to gate Save.                    |
| MOB-15 | `android.permissions: ["NOTIFICATIONS"]` is not a real Android permission; expands to a junk `<uses-permission>`. Should be `POST_NOTIFICATIONS` or omitted.                            |
| MOB-16 | Five screens pass `onRetry` unconditionally, offering Retry on 404/403/422; the other nine gate it on `retryable` correctly.                                                            |
| MOB-17 | The 15-minute lesson join window is hand-duplicated in web and mobile; `canReview` is derived client-side while its two siblings ship from the server.                                  |

## Store/config blockers (not code defects)

| ID    | Finding                                                                                                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOB-1 | **P0 for release.** `extra.eas.projectId` is the all-zero placeholder, so `eas build` cannot run **and** push is silently dead in every build — `registerForPush` bails on a zero-prefixed id before minting a token. The whole push subsystem is inert. Requires `eas init`. |

---

## Residual, recorded, not a defect

A student can derive a tutor's exact `platform_fee_bps` from their own booking
row (`platform_fee_cents / price_cents`) — proven, 700 bps recovered. Migration
0041 closed the anonymous mass-harvest; this costs a real booking and reveals
one tutor. Named here so the limit is visible.
