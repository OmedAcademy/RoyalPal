import { test, expect, type Page } from "@playwright/test";

const LEGAL_PAGES = [
  "/legal/terms",
  "/legal/privacy",
  "/legal/cookies",
  "/legal/acceptable-use",
  "/legal/cancellation",
  "/legal/safeguarding",
  "/legal/tutor-terms",
];

const PUBLIC_PAGES = ["/", "/our-impact", "/login", "/signup", "/forgot-password", ...LEGAL_PAGES];

/**
 * Collects browser console errors and failed requests for the life of a page.
 *
 * Asserted at the end of a test rather than as they arrive: a listener that
 * throws mid-navigation reports the wrong location and hides whatever followed.
 */
function watchForFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`uncaught: ${error.message}`));
  page.on("requestfailed", (request) => {
    // A cancelled navigation is not a failure; anything else is.
    const failure = request.failure()?.errorText ?? "";
    if (failure.includes("ERR_ABORTED")) return;
    failures.push(`request: ${request.url()} — ${failure}`);
  });
  return failures;
}

test.describe("public pages render", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} responds 200 and renders`, async ({ page }) => {
      const failures = watchForFailures(page);
      const response = await page.goto(path);

      expect(response?.status(), `${path} should serve 200`).toBe(200);

      // A page title is what a browser tab, a bookmark and a search result all
      // show. An empty one is invisible in development and embarrassing later.
      await expect(page).toHaveTitle(/\S/);

      // Exactly one h1: assistive technology uses it as the page's name, and
      // two of them means neither is the answer to "where am I".
      await expect(page.locator("h1")).toHaveCount(1);

      // The document language, without which a screen reader guesses the
      // pronunciation of the whole page.
      await expect(page.locator("html")).toHaveAttribute("lang", /\w/);

      expect(failures, `${path} produced browser errors`).toEqual([]);
    });
  }
});

test.describe("navigation", () => {
  test("home offers a way in and a way to browse", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /sign in|log in/i }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: /create account|sign up|get started/i }).first(),
    ).toBeVisible();
  });

  test("every legal page is reachable from the footer", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();

    const hrefs = await footer
      .locator("a")
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).getAttribute("href")),
      );
    // Not every legal page needs a footer link, but a footer that links to
    // none of them means the policies are unreachable to anyone who has not
    // memorised the URLs.
    expect(hrefs.some((href) => href?.startsWith("/legal/"))).toBe(true);
  });

  test("an unknown path serves the app's own 404, not a stack trace", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("body")).not.toContainText(/at .*\.tsx:\d+/);
  });
});

test.describe("the sign-in form", () => {
  test("labels its fields and refuses to submit empty", async ({ page }) => {
    await page.goto("/login");

    const email = page.getByLabel(/email/i);
    const password = page.getByLabel(/password/i).first();
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();

    // Typed correctly, so a phone offers the right keyboard and the password
    // manager offers the right entry.
    await expect(email).toHaveAttribute("type", "email");
    await expect(password).toHaveAttribute("type", "password");
    await expect(email).toHaveAttribute("autocomplete", "email");

    // Submitting nothing must not navigate: the browser's own required-field
    // handling stops it before any request is made.
    await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("offers password recovery and a route to signing up", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /forgot/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign up|create/i }).first()).toBeVisible();
  });
});

test.describe("crawlability", () => {
  test("robots.txt points at the sitemap", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    expect(await response.text()).toMatch(/sitemap/i);
  });

  test("sitemap.xml is well-formed XML listing at least the home page", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("<urlset");
    expect(body).toMatch(/<loc>https?:\/\/[^<]+<\/loc>/);
  });
});

test.describe("layout holds at phone width", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "viewport check, one engine is enough",
  );

  for (const path of ["/", "/login", "/legal/terms"]) {
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto(path);
      // A horizontal scrollbar on a phone is the single most common symptom of
      // a fixed width that escaped a container.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }
});
