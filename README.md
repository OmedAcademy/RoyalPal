# RoyalPal

A global tutoring marketplace — students discover tutors, book and pay for lessons, and leave reviews; tutors manage availability, lessons, and earnings; admins verify tutors and oversee the platform.

**Teach Without Borders. Learn Without Limits.**

RoyalPal runs on the **web, iOS and Android** from one backend.

---

## Status, stated plainly

> **Payments are intentionally unconfigured.** Stripe Connect Express is
> code-complete and unit-tested and has **never run against real Stripe**. With
> no keys set the app degrades honestly: browsing, profiles, search, messaging,
> support, reviews and cancellation all work, and booking declines with a clear
> message _before_ creating a row. See
> [`docs/STRIPE_STATUS.md`](docs/STRIPE_STATUS.md).

> **Production is behind by twelve migrations** (`0028`–`0039`), and four of
> them break the live site if applied before the matching code is deployed.
> [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) is the procedure — read it before
> touching the database.

> **Email, push and Google Meet are dormant** until their keys are set. Each
> one is wired and guarded; none has ever delivered anything from this
> environment.

---

## Architecture

The rule that shapes everything: **business logic exists once.** Every mobile
write goes through `/api/v1/*`, and every one of those routes delegates to the
same Server Action the web form posts to. Price derivation, slot validation,
the cancellation policy, the refund rules, the age gate and every authorization
check are reached by two transports and implemented in one place.

```
   iOS app  ─┐
             ├─►  /api/v1/*  ─►  Server Actions  ─►  Supabase (RLS + triggers)
Android app ─┘                         ▲
                                       │
   Web app  ──────────────────────────-┘   (same actions, via <form>)
```

Authorization is layered, and the database is the layer that cannot be
bypassed: middleware → `requireProfile()` → `activeUserOrError()` → Row Level
Security → column-lock triggers.

## Stack

| Layer          | Choice                                                                                |
| -------------- | ------------------------------------------------------------------------------------- |
| Web            | Next.js 15 (App Router, Server Components, Server Actions)                            |
| Mobile         | Expo SDK 57 / React Native 0.86, expo-router — see [`docs/MOBILE.md`](docs/MOBILE.md) |
| Language       | TypeScript (strict), everywhere                                                       |
| Data           | Supabase — Postgres + Auth + Storage, RLS on every table                              |
| Payments       | Stripe Connect Express (destination charges) — unconfigured                           |
| Email          | Resend — dormant until keyed                                                          |
| Push           | Expo Push → APNs / FCM                                                                |
| Video          | Google Meet via the Calendar API — dormant until keyed                                |
| Scheduled work | Vercel Cron → `/api/cron/*`                                                           |
| Styling        | Tailwind CSS v4 with CSS-variable design tokens                                       |
| Tests          | Vitest, including real-Postgres (PGlite) RLS tests                                    |

---

## Documentation

| Document                                                                         | For                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                                       | Deploying, env vars, cron, rollback, troubleshooting |
| [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md)                                       | **Read before touching production's database**       |
| [`docs/MOBILE.md`](docs/MOBILE.md)                                               | The iOS and Android apps, builds, store readiness    |
| [`docs/STRIPE_STATUS.md`](docs/STRIPE_STATUS.md)                                 | Where payments stand, and what surprises await       |
| [`docs/STRIPE_TEST_MODE_VERIFICATION.md`](docs/STRIPE_TEST_MODE_VERIFICATION.md) | Turning "tested against mocks" into "verified"       |
| [`docs/RECONCILIATION_DESIGN.md`](docs/RECONCILIATION_DESIGN.md)                 | Designed, deliberately not built yet                 |

---

## Legal

Seven documents live under `/legal`. Every one carries a visible **awaiting
legal review** banner and inline flags on the clauses a lawyer must decide.
They describe what the software genuinely does — a factual starting point, not
a substitute for advice.

Two positions are worth knowing before reading anything else:

- **RoyalPal is 18+**, enforced inside the `auth.users` insert, not merely
  asked on a form. That is the restrictive default chosen because serving
  minors carries safeguarding duties nobody here has been advised on.
- **Messages are retained and admin-readable**, and cannot be edited or deleted
  by either party. A report about a message nobody may read cannot be
  investigated. Both facts are stated to users before they type anything.

---

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev
```

### Environment variables

| Variable                        | Purpose                                           |
| ------------------------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser / RLS-scoped key                          |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server-only.** Bypasses RLS — never expose      |
| `NEXT_PUBLIC_APP_URL`           | Absolute app URL (Stripe redirects, emails)       |
| `STRIPE_SECRET_KEY`             | Stripe API key (shared Lingora account)           |
| `STRIPE_WEBHOOK_SECRET`         | Verifies inbound Stripe webhooks                  |
| `STRIPE_ROYALPAL_PRODUCT_ID`    | _Optional._ Stable RoyalPal Product — see below   |
| `RESEND_API_KEY`                | _Optional._ Email stays dormant until this is set |
| `EMAIL_FROM_ADDRESS`            | _Optional._ Sender address for email              |

### Database

39 migrations, plain SQL in `supabase/migrations`, applied in filename order:

```bash
npx supabase db push
```

⚠️ Against **production** that command is not safe on its own — four of the
outstanding migrations remove a permission the currently-deployed code relies
on. [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) has the ordering, the
verification query and the rollback.

### Tests

```bash
npm run typecheck && npm run lint && npm test && npm run build
cd mobile && npm run typecheck && npx expo export --platform ios
```

The database tests run every migration against a real Postgres (PGlite) and
exercise RLS and triggers as each actor — anonymous, student, tutor, admin,
service role. They are where the security posture is actually pinned.

### Stripe: shared account with Lingora

RoyalPal runs inside the **existing Lingora Stripe account** — same keys, no new
account. The two products are separated by **metadata only**, so the rules are:

- Every Checkout Session, its PaymentIntent, and its Product carry
  `app=royalpal`, `platform=royalpal`, `environment=<vercel-env>`, plus
  `booking_id` / `student_id` / `tutor_id` (`lib/stripe/app-metadata.ts`).
- The webhook **ignores any event not tagged `app=royalpal`**. A Stripe account
  fans every subscribed event type out to every endpoint registered on it, so
  this endpoint also receives Lingora's events; the tag is what separates them,
  and it fails closed on untagged events.
- Filter RoyalPal revenue in the shared account with:
  ```
  stripe.paymentIntents.search({ query: "metadata['app']:'royalpal'" })
  ```
  Append ` AND metadata['environment']:'production'` to exclude preview traffic.

**One-time setup (run once against the shared account):**

```bash
stripe products create --name="RoyalPal Lesson" \
  --metadata[app]=royalpal --metadata[platform]=royalpal
# then set the returned prod_… id:
#   STRIPE_ROYALPAL_PRODUCT_ID=prod_xxx
```

Lessons are billed with a dynamic `unit_amount`, **not** stored Prices: Stripe
Prices are immutable, so a per-tutor Price catalog would mint a new object on
every rate change and grow without bound. Without the env var the code falls
back to an ad-hoc, still-tagged Product.

### Google Meet setup (live lessons)

Lessons get a Google Calendar event with a Meet link, and both parties are
invited. The integration is **dormant until credentials are set** — bookings
still work, just without a video link.

**Auth model.** RoyalPal signs users in with Supabase email/password, _not_
Google OAuth, so there is no per-user Google session to borrow. Instead one
platform-owned "operations" Google account owns every lesson event, with tutor
and student as attendees. Authorize it once; the server refreshes access
tokens forever afterwards.

**1 — Google Cloud (console.cloud.google.com)**

| Setting                 | Value                                                       |
| ----------------------- | ----------------------------------------------------------- |
| API to enable           | **Google Calendar API** (only this one)                     |
| OAuth client type       | **Web application**                                         |
| Authorized redirect URI | `http://localhost:3000/oauth2callback` (must match exactly) |
| Scope                   | `https://www.googleapis.com/auth/calendar.events`           |

There is no separate "Meet API" to enable — Meet rooms are created _through_
Calendar via `conferenceData.createRequest`.

> ⚠️ **Publish the OAuth consent screen.** While its status is **Testing**,
> Google **expires refresh tokens after 7 days**, so the integration would die
> every week. Set it to **In production** for a non-expiring token. (For a
> Workspace account, "Internal" user type also avoids the expiry.)

**2 — Mint the refresh token** (once, signed in as the ops account):

```bash
node scripts/google-refresh-token.mjs
```

Paste the printed `GOOGLE_REFRESH_TOKEN` into `.env.local`. Never commit it.

**3 — Verify against the real API:**

```bash
node scripts/google-verify.mjs
```

This makes real calls and prints evidence: token refresh, event id, Meet URL,
attendees, reschedule-preserves-link, and deletion. It creates a throwaway
event ~24 h out and removes it, so it is safe against the production calendar.
Add `VERIFY_TUTOR_EMAIL` / `VERIFY_STUDENT_EMAIL` to also prove invitations.

**Troubleshooting**

| Symptom                           | Cause                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `invalid_grant` on refresh        | Token revoked, or consent screen still in Testing (7-day expiry)              |
| Script prints no `refresh_token`  | Prior consent exists — revoke at myaccount.google.com/permissions and retry   |
| `redirect_uri_mismatch`           | `GOOGLE_REDIRECT_URI` differs from the console value, character for character |
| Event created without a Meet link | `conferenceDataVersion=1` missing, or Meet disabled for the account           |
| Attendees get no invite           | `sendUpdates=all` missing, or the calendar isn't owned by the ops account     |

### Creating the first admin

Public signup deliberately refuses the `admin` role. Promote an existing user manually:

```sql
update public.profiles set role = 'admin' where id = '<auth-user-id>';
```

---

## Quality gates

All five must pass before any change lands:

```bash
npm run format
npm run typecheck
npm run lint
npm run test
npm run build
```

---

## Architecture

```
app/                 Routes (App Router)
  (auth)/            Login + signup (public route group)
  student/           Student area  — gated by requireProfile(["student"])
  tutor/             Tutor area    — gated by requireProfile(["tutor"])
  admin/             Admin console — gated by requireProfile(["admin"])
  api/               Stripe webhook + health
components/          UI grouped by domain (auth, booking, admin, ui, …)
lib/
  actions/           Server Actions ("use server") — the write surface
  supabase/          Data access; one module per domain
  notifications/     NotificationService + pluggable delivery channels
  stripe/            Checkout + webhook handlers
  i18n/              ISO 3166 countries + ISO 639 languages datasets
  utils/             Pure helpers (format, dates, status maps)
supabase/migrations/ Schema, RLS policies, indexes
```

### Security model

Three Supabase clients, each with a deliberate trust level:

- **`lib/supabase/client.ts`** — browser, RLS-scoped.
- **`lib/supabase/server.ts`** — server, RLS-scoped as the signed-in user. **Default choice.**
- **`lib/supabase/admin.ts`** — service role, **bypasses RLS**. Only for the Stripe webhook, the notification writer, and admin-gated routes. Guarded by `server-only`.

Authorization is enforced in three layers: middleware (edge), `requireProfile()` (server component), and RLS (database). The database is the last line of defence and never assumes the app is correct.

### Key invariants

- **Prices are always derived server-side** from the tutor's stored rate — never from client input.
- **Double-booking is prevented by a Postgres exclusion constraint**, not app logic.
- **Booking status transitions are enforced by a database trigger** (e.g. only the service role may confirm a payment).
- **Reviews are immutable** — no update/delete policy exists.
- **`payments` has no client write policy** — only the Stripe webhook writes it.
- **Suspended accounts** are blocked at both middleware and `requireProfile()`.
- **`NotificationService.emit()` never throws** — a notification failure cannot break a booking or payment.
- **Booking maintenance sweeps are throttled and coalesced** (`lib/supabase/maintenance.ts`); they belong in a cron job long-term.

### Conventions

- Server Components by default; add `"use client"` only for interactivity.
- All data access lives in `lib/supabase/*`, never inline in a page.
- All mutations are Server Actions in `lib/actions/*`, validated with Zod.
- Styling uses semantic design tokens (`bg-surface`, `text-muted`, `border-hairline`, `text-royal`) — avoid raw palette colours.
- Comments explain **why**, not what.
