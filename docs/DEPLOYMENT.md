# Deploying RoyalPal

Everything an operator needs, and an honest list of what is not verified.

---

## What runs where

| Piece                   | Where                        | Notes                            |
| ----------------------- | ---------------------------- | -------------------------------- |
| Web app + API           | Vercel                       | Next.js 15, App Router           |
| Database, auth, storage | Supabase                     | Postgres with RLS on every table |
| Scheduled jobs          | Vercel Cron → `/api/cron/*`  | Defined in `vercel.json`         |
| Email                   | Resend                       | Dormant until keys are set       |
| Payments                | Stripe Connect Express       | **Intentionally not configured** |
| Video lessons           | Google Meet via Calendar API | Dormant until keys are set       |
| Push                    | Expo Push → APNs / FCM       | Needs an EAS project id          |
| Mobile apps             | EAS Build                    | See `docs/MOBILE.md`             |

> ⚠️ **Two Vercel projects exist** — `royal-pal` and `royalpal-mvp`, both under
> the `lingora1` team. Which one is production has not been determined from
> inside this repository. **Confirm before deploying**, because promoting to
> the wrong one deploys nothing useful and leaves the real site untouched.

---

## Environment variables

`.env.local.example` is the authoritative list with a comment explaining every
entry. Summary of what is required to launch:

### Required

| Variable                        | Why                                                          |
| ------------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Public; safe in a client bundle                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public by design — RLS is the protection                     |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server only.** Bypasses RLS entirely                       |
| `NEXT_PUBLIC_APP_URL`           | Absolute URLs in email, OG tags, sitemap                     |
| `CRON_SECRET`                   | Gates `/api/cron/*`. Generate with `openssl rand -base64 48` |

### Strongly recommended before launch

| Variable                               | Without it                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | **No email is sent at all** — including password resets, which makes account recovery impossible |
| `ALERT_WEBHOOK_URL`                    | Errors reach stdout and nobody else                                                              |

### Deliberately unset

`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
With these unset the app degrades honestly: browsing, profiles, search,
messaging, support and cancellation all work; booking declines with a clear
message _before_ creating a row, so there is no orphan to clean up.

### Never in a client bundle

`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `CRON_SECRET`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `RESEND_API_KEY`. None of these
is `NEXT_PUBLIC_*`, and none belongs in `mobile/.env` either — there is no such
thing as a secret in a client binary.

---

## First deployment, in order

1. **Confirm which Vercel project is production.**
2. **Set the environment variables** above, for the Production environment.
3. **Deploy the application.** The code must be live _before_ the migrations —
   see `docs/MIGRATIONS.md` for why, and which four break the site if applied
   early.
4. **Apply migrations `0028`–`0039`** and run the verification query.
5. **Configure Supabase Auth**: add `https://<domain>/auth/callback` to the
   redirect allowlist and set the Site URL. _Without this, email confirmation
   and password reset both fail silently_ — the link lands on an error page
   with nothing in any log explaining why.
6. **Seed the subject list.** `supabase/seed.sql` holds six development
   subjects; production needs the real taxonomy or tutors cannot finish
   onboarding.
7. **Create the first admin.** Admins cannot self-register (migration `0012`
   refuses it). Sign up as a tutor, then:
   ```sql
   update public.profiles set role = 'admin' where id = '<uuid>';
   ```
8. **Verify the cron jobs are registered** in the Vercel dashboard, and hit one
   by hand with the bearer token to confirm `CRON_SECRET` matches:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/lesson-lifecycle
   ```
9. **Send a real email** to a Gmail and an Outlook address and confirm both
   arrive and neither lands in spam. SPF and DKIM must be set up on the sending
   domain first.

---

## Scheduled jobs

| Path                         | Schedule        | Does                                                                            |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `/api/cron/lesson-lifecycle` | every 10 min    | Completes finished lessons; releases unpaid bookings                            |
| `/api/cron/reminders`        | every 15 min    | Lesson reminders ~1 hour ahead                                                  |
| `/api/cron/maintenance`      | daily 03:20 UTC | Closes old conversations, prunes rate limits, carries out due account deletions |

All three are idempotent — each `WHERE` clause is the condition being fixed, so
re-running finds nothing to do. Safe to retry, safe to run concurrently.

Auth **fails closed**: with no `CRON_SECRET` set, every job returns 503 rather
than running. That is the opposite of the rate limiter's behaviour, and
deliberately so — a missed sweep is a delay, an open sweep endpoint is a
stranger able to cancel every pending booking on the platform.

**If lessons stop completing, check these jobs first.** Reviews require a
completed lesson, so a silent cron failure presents as "nobody can leave a
review" rather than as anything resembling a cron problem.

---

## Verifying a deploy

**Admin → Diagnostics** (`/admin/diagnostics`) is the first page to open after
any deploy or configuration change. It checks the running system rather than
repeating what a document says:

| Group          | Answers                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Database       | Can it be reached, how fast, and are there any subjects to book                                             |
| Database       | Which of migrations `0028`–`0040` this database actually has, probed table by table                         |
| Authentication | Are all three Supabase values present, and does each carry the role it should                               |
| Authorization  | Does an admin account exist at all (admins cannot self-register)                                            |
| Environment    | Is `NEXT_PUBLIC_APP_URL` absolute, non-localhost in production, and matching the origin serving the page    |
| Scheduled jobs | Is `CRON_SECRET` set and long enough                                                                        |
| Payments       | Stripe's state, including a live key on a non-production deployment, or a secret key with no webhook secret |
| Delivery       | Email, push and in-app                                                                                      |
| Lessons        | Google Meet, including the partially-configured case                                                        |
| Storage        | Does the avatars bucket exist and is it public                                                              |
| Public surface | The home page, all seven policy pages, robots.txt, sitemap.xml and `/api/v1/me`, fetched over HTTP          |

Three states, and the distinction is the point:

- **OK** — configured _and_ verified, not merely set.
- **Not configured** — deliberately unavailable. Stripe with no keys is this,
  because it is the documented state of the project.
- **Needs attention** — broken or unsafe. A live Stripe key on a preview
  deployment is this, even though every variable is present.

A page that paints known gaps red trains its reader to ignore red.

Two that are deliberately NOT yellow, because "unset" does not mean "off":

- **`CRON_SECRET` unset is red.** Cron auth fails closed, so an unset secret is
  three jobs returning 503 forever — lessons never complete and reviews become
  impossible to leave.
- **A Stripe secret key with no webhook secret is red.** Students would be
  charged and no booking would ever be confirmed, because confirmation happens
  on the webhook. Worse than having no Stripe at all.

---

## Verifying delivery after a deploy

**Admin → Delivery** (`/admin/delivery`) is the first thing to open after
adding or rotating a notification credential.

It reports what the deployment can actually deliver — whether the email
provider has both of its variables, whether Expo push is authenticated — and
sends a test through every channel to **your own account**, reporting each
channel's own answer including the provider's error text.

Why it exists: every secondary channel stays dormant until its credentials are
set, and `NotificationService.emit` swallows delivery failures by contract so a
broken mailbox can never fail a booking. Both decisions are correct and
together they mean **a misconfigured deployment looks identical to a working
one from the outside** — notifications appear in the in-app feed and simply
never arrive anywhere else. Without this page the first person to notice is a
student who missed a lesson.

The test is self-only (the recipient comes from the session and cannot be
named), bypasses your own notification preferences so a muted category is never
mistaken for a broken channel, and is recorded in the audit log.

> A green push result means **Expo accepted it**, not that a phone showed it.
> Expo answers before the device does. Green push with nothing on the lock
> screen means the token is stale or the device has notifications off — not
> that the server is broken.

---

## Rolling back

```bash
# Vercel keeps every previous build; promoting one is instant.
# Dashboard → Deployments → the last known-good → Promote to Production
```

A code rollback alone is safe **unless** a permission-removing migration has
been applied in between. See `docs/MIGRATIONS.md`.

---

## Troubleshooting

| Symptom                                  | Almost always                                                  |
| ---------------------------------------- | -------------------------------------------------------------- |
| Email confirmation link errors           | `/auth/callback` not in Supabase's redirect allowlist (step 5) |
| No email arrives, anywhere               | `RESEND_API_KEY` unset, or the sending domain is unverified    |
| Not sure whether a channel works at all  | Open **Admin → Delivery** and send yourself a test             |
| "Booking is temporarily unavailable"     | Stripe unconfigured. Expected today                            |
| Lessons never reach "completed"          | `/api/cron/lesson-lifecycle` failing — check `CRON_SECRET`     |
| Reviews impossible to leave              | Same cause as above; a review needs a completed lesson         |
| Tutor onboarding fails after a migration | `0028` applied before its code was deployed                    |
| Every signup fails                       | `0039` applied before the signup form was deployed             |
| "permission denied" on a normal read     | A missing GRANT, not RLS. See migration `0011`                 |
| Cron returns 401                         | `CRON_SECRET` differs between Vercel and the caller            |
| Cron returns 503                         | `CRON_SECRET` is not set at all                                |

---

## What is NOT verified

Stated plainly, because a deployment runbook that overstates its own confidence
is worse than none:

- **Nothing here has run against the production Supabase project.** Every
  migration is verified against a real Postgres (PGlite) in CI, which is a
  strong signal and not the same thing.
- **No Stripe call has ever been made** with real keys, in any mode.
- **Email has never been sent** — no Resend key has existed in this
  environment.
- **Push has never been delivered** — that needs an EAS project id.
- **The mobile apps have never run on a physical device**, and have never been
  signed, uploaded or submitted to either store.
- **Which Vercel project is production is unknown from inside this repo.**
