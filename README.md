# RoyalPal

A global tutoring marketplace — students discover tutors, book and pay for lessons, and leave reviews; tutors manage availability, lessons, and earnings; admins verify tutors and oversee the platform.

**Teach Without Borders. Learn Without Limits.**

---

## Stack

| Layer     | Choice                                                     |
| --------- | ---------------------------------------------------------- |
| Framework | Next.js 15 (App Router, Server Components, Server Actions) |
| Language  | TypeScript (strict)                                        |
| Data      | Supabase — Postgres + Auth + Storage, Row Level Security   |
| Payments  | Stripe Checkout (Connect payouts not yet implemented)      |
| Styling   | Tailwind CSS v4 with CSS-variable design tokens            |
| Tests     | Vitest                                                     |

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

Migrations are plain SQL in `supabase/migrations`, applied in filename order:

```bash
npx supabase db push
```

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
