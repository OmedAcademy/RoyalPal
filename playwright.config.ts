import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Browser smoke tests for the surface a signed-out visitor sees.
 *
 * Scope is deliberate. These run against `next start` with PLACEHOLDER Supabase
 * credentials and no database, so they cover exactly the pages that render
 * without one: marketing, legal and the auth forms. That is not a limitation
 * worked around — it is what makes them runnable in CI on every push, with no
 * fixtures to seed and nothing to leave behind.
 *
 * What they catch is the one class of failure the 533 unit tests cannot: a page
 * that compiles and throws at render, a layout that loses its header, a
 * middleware change that starts redirecting public routes, a legal page quietly
 * 404ing after a rename. Every one of those has shipped in some project, and
 * none of them is visible to a type checker.
 *
 * Authenticated journeys (booking, messaging, the lesson lifecycle) are covered
 * by the database-level tests under tests/db, which run real RLS and triggers
 * against PGlite. They are not duplicated here.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    // The app is served over plain HTTP locally; nothing here needs a cert.
    ignoreHTTPSErrors: false,
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // One mobile viewport, because the layout is the thing most likely to
    // break there and nothing else in the suite would notice.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],

  // Reuses an already-running server locally so a watch loop stays fast, and
  // starts its own in CI. `next start` needs a build first — see the CI job.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key",
          NEXT_PUBLIC_APP_URL: baseURL,
        },
      },
});
