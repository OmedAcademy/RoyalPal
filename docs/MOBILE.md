# RoyalPal mobile (iOS and Android)

One Expo app in `mobile/`, one codebase, two platforms. It talks to the same
RoyalPal backend the website does.

---

## The architectural decision, and why

**The mobile apps contain no business logic.** Every write goes through
`/api/v1/*`, and every one of those routes delegates to the same Server Action
the web form posts to. Price derivation, slot validation, the cancellation
policy, the refund rules, the age gate and every authorization check live in
exactly one place and are reached by two transports.

The alternative — a set of mobile-only handlers — is how a marketplace ends up
giving a student on a phone a refund a student on a laptop would not.

What made it possible is one change in one file: `lib/supabase/server.ts`
accepts a session from an `Authorization: Bearer` header as well as from
cookies. Native apps have no cookie jar, so they hold the Supabase session
themselves; because every server-side caller already goes through
`createClient()`, reading the token there lets the existing actions serve
mobile unchanged.

```
   iOS app  ─┐
             ├─► /api/v1/*  ─►  Server Actions  ─►  Supabase (RLS)
Android app ─┘                        ▲
                                      │
   Web app  ─────────────────────────-┘  (same actions, via <form>)
```

---

## Stack

| Piece           | Choice                           | Why                                         |
| --------------- | -------------------------------- | ------------------------------------------- |
| Framework       | Expo SDK 57, React Native 0.86   | One codebase for both platforms             |
| Routing         | expo-router 57                   | File-based, and gives deep linking for free |
| Auth            | `@supabase/supabase-js`          | The same session the API expects            |
| Session storage | expo-secure-store, **chunked**   | See below — this one bites                  |
| Push            | expo-notifications → Expo Push   | Fronts APNs and FCM; needs no secret        |
| Payments        | System browser → Stripe Checkout | Not a webview — see below                   |

---

## Three things that will bite you

**1. SecureStore chunking (`lib/storage.ts`).** A Supabase session is two JWTs
plus the user object and routinely exceeds 2 KB. SecureStore is not built for
values that size, so storing the session directly works in development and
starts dropping sessions in production as profiles grow — presenting as "the
app randomly signs me out". The adapter splits it and reassembles on read; a
partially written value is treated as absent, costing one sign-in rather than
leaving a corrupt session.

**2. `Tabs` moved (`expo-router/tabs`).** In expo-router 57 the Tabs layout is
no longer exported from the package root. Importing it from `expo-router`
resolves to `undefined` and fails at render with a message pointing nowhere
near the cause.

**3. Metro resolution (`mobile/metro.config.js`).** `mobile/` sits inside the
web repo, which has its own React (19.2.4 for Next.js) next to the 19.2.3 Expo
pins. Node resolution walks up, so React can be resolved twice — and two copies
of React in one bundle is a crash, not a warning: hooks dispatch through
module-level state, so a component from one copy with a hook from the other
throws "invalid hook call" from obviously correct code. `extraNodeModules`
pins react, react-dom and react-native to this project's copies.

> `npx expo-doctor` still reports the duplicate, because it inspects the
> filesystem rather than the Metro config. The bundle is correct; the report is
> the inherent cost of nesting one project inside another.

---

## Payments open the system browser, not a webview

`app/book/[id].tsx` hands the Stripe Checkout URL to
`WebBrowser.openBrowserAsync`. Card autofill, 3-D Secure challenges and
Stripe's own fraud signals all depend on a real browser session; a webview
degrades all three and gets payments declined. It is also what Apple and
Google's rules expect for an external web payment flow.

---

## Security: what is and is not in the bundle

Everything prefixed `EXPO_PUBLIC_` is embedded in the app binary and readable
by anyone who downloads it. The only values there are the Supabase project URL
and the anon key, **both designed to be public** — Row Level Security, not
secrecy of that key, is what protects the data.

**Never in a mobile build:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
`CRON_SECRET`, or any other server credential. There is no such thing as a
secret in a client binary. Every privileged operation goes through the API.

Push tokens are never hardcoded. They are fetched from the OS each launch and
POSTed to the server, which _claims_ the token for the signed-in account —
which is what stops the previous user's lesson reminders landing on the next
person's lock screen after a shared phone changes hands.

---

## Running it

```bash
cd mobile
cp .env.example .env        # fill in the three values
npm install
npm start                   # then press i / a, or scan with Expo Go
```

`EXPO_PUBLIC_API_URL` must be reachable _from the device_. `localhost` works on
a simulator and fails on a physical phone — use your machine's LAN address.

Verify without a device:

```bash
npm run typecheck                        # tsc over the whole app
npx expo export --platform ios           # real Metro bundle
npx expo export --platform android
```

---

## Builds and store submission

`eas.json` defines development, preview and production profiles.

```bash
npx eas init            # writes the real projectId into app.json
npx eas build --platform ios --profile production
npx eas build --platform android --profile production
```

| Setting               | Value              |
| --------------------- | ------------------ |
| iOS bundle identifier | `com.royalpal.app` |
| Android package       | `com.royalpal.app` |
| URL scheme            | `royalpal://`      |
| Universal / app links | `royalpal.app`     |

### What is NOT done, and cannot be from here

- **`extra.eas.projectId` is a placeholder.** `getExpoPushTokenAsync` cannot
  mint a token without a real one, so **push is inert until `eas init` runs**.
  The code path is complete and guarded; it returns null rather than throwing.
- **No Apple or Google credentials exist in this environment**, so nothing has
  been signed, uploaded or submitted. The project is configured for it; it has
  not happened.
- **iOS universal links need `apple-app-site-association`** served from
  `royalpal.app`, and Android app links need `assetlinks.json`. Both require
  the signing team/fingerprint that only exists after a first real build.
- **Store listing assets** — screenshots, descriptions, privacy nutrition
  labels, the data-safety form — are content, not code, and are not written.

---

## Known gaps, stated rather than hidden

These are real, deliberate, and visible in the UI rather than behind a button
that looks native and is not:

| Gap                       | Where it shows            | Why                                                                                          |
| ------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| Avatar upload             | "Change photo on the web" | Needs an image picker and a direct-to-storage upload; everything else on the form is native  |
| Date exceptions           | Read-only on the app      | The weekly template is editable natively; one-off date overrides are still a web surface     |
| Account deletion          | "Account and deletion"    | Deliberately not a two-tap action on a phone                                                 |
| Admin                     | Web only, by design       | An admin console on a phone is not a product requirement                                     |
| Password reset completion | Opens a browser           | The emailed link targets the web callback; the app says so instead of appearing to handle it |

Closed since the first cut, and now native: profile editing (`app/profile/edit.tsx`),
weekly availability (`app/availability/edit.tsx`), rescheduling
(`app/reschedule/[id].tsx`) and leaving a review (`app/review/[id].tsx`). Each
posts to a `/api/v1` route that invokes the **same Server Action the web form
posts to**, so the Zod schema, the column allowlist and the privileged-column
locks have one implementation rather than two.
