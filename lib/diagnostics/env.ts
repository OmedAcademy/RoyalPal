/**
 * Configuration checks, as pure functions over an environment record.
 *
 * Pure so they can be tested exhaustively without a database, a network or a
 * process.env mutation — and so the rules live somewhere a reader can check
 * them against the deployment docs line by line.
 *
 * WHAT THE THREE STATES MEAN, because getting this wrong makes the page
 * useless in one of two ways:
 *
 *   green  — configured AND verified. Not "the variable is set".
 *   yellow — deliberately unavailable. Stripe with no keys is yellow, because
 *            that is the documented state of this project, not a fault.
 *   red    — broken, or unsafe. A live Stripe key in a preview deployment is
 *            red even though every variable is present.
 *
 * A page that paints known-and-accepted gaps red trains its reader to ignore
 * red, which costs exactly as much as having no page.
 */

export type CheckStatus = "green" | "yellow" | "red";

export type Check = {
  id: string;
  group: string;
  label: string;
  status: CheckStatus;
  /** What was found. Never contains a credential value. */
  detail: string;
  /** What to do about it, when there is something to do. */
  remedy?: string;
};

export type Env = Record<string, string | undefined>;

const present = (env: Env, key: string) => Boolean(env[key]?.trim());

/** A Supabase key is a JWT; this reads the role claim without verifying it. */
export function jwtRole(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Whether this deployment is the real one. Vercel sets VERCEL_ENV to
 * production/preview/development; a self-hosted deployment has only NODE_ENV.
 */
export function isProduction(env: Env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

export function checkSupabaseConfig(env: Env): Check[] {
  const checks: Check[] = [];
  const url = env.NEXT_PUBLIC_SUPABASE_URL;

  checks.push(
    !url
      ? {
          id: "supabase.url",
          group: "Authentication",
          label: "Supabase URL",
          status: "red",
          detail: "NEXT_PUBLIC_SUPABASE_URL is not set. Nothing can reach the database.",
          remedy: "Set NEXT_PUBLIC_SUPABASE_URL to your project URL.",
        }
      : !isAbsoluteHttpUrl(url)
        ? {
            id: "supabase.url",
            group: "Authentication",
            label: "Supabase URL",
            status: "red",
            detail: "NEXT_PUBLIC_SUPABASE_URL is not an absolute http(s) URL.",
            remedy: "It must look like https://<ref>.supabase.co",
          }
        : {
            id: "supabase.url",
            group: "Authentication",
            label: "Supabase URL",
            status: "green",
            detail: `Set to ${new URL(url).host}.`,
          },
  );

  const anonRole = jwtRole(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  checks.push(
    !present(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY")
      ? {
          id: "supabase.anon",
          group: "Authentication",
          label: "Supabase anon key",
          status: "red",
          detail: "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.",
          remedy: "Copy the anon/public key from Supabase → Settings → API.",
        }
      : anonRole === "service_role"
        ? {
            id: "supabase.anon",
            group: "Authentication",
            label: "Supabase anon key",
            status: "red",
            // This is the single worst configuration mistake available here:
            // the value is shipped to every browser and every phone.
            detail:
              "The SERVICE-ROLE key is in NEXT_PUBLIC_SUPABASE_ANON_KEY. It is published to every client and bypasses Row Level Security entirely.",
            remedy:
              "Replace it with the anon key and ROTATE the service-role key in Supabase immediately — treat the old one as compromised.",
          }
        : anonRole === "anon"
          ? {
              id: "supabase.anon",
              group: "Authentication",
              label: "Supabase anon key",
              status: "green",
              detail: "Present, and carries the anon role.",
            }
          : {
              id: "supabase.anon",
              group: "Authentication",
              label: "Supabase anon key",
              status: "red",
              detail: `Present, but its role claim reads ${anonRole ?? "unreadable"} rather than anon.`,
              remedy: "Check you copied the anon/public key, not another value.",
            },
  );

  const serviceRole = jwtRole(env.SUPABASE_SERVICE_ROLE_KEY);
  checks.push(
    !present(env, "SUPABASE_SERVICE_ROLE_KEY")
      ? {
          id: "supabase.service",
          group: "Authentication",
          label: "Supabase service-role key",
          status: "red",
          detail:
            "SUPABASE_SERVICE_ROLE_KEY is not set. Booking creation, cancellation, notifications and every cron job need it.",
          remedy: "Set it as a SERVER-ONLY variable. It must never be NEXT_PUBLIC_.",
        }
      : serviceRole === "service_role"
        ? {
            id: "supabase.service",
            group: "Authentication",
            label: "Supabase service-role key",
            status: "green",
            detail: "Present, server-side only, and carries the service_role role.",
          }
        : {
            id: "supabase.service",
            group: "Authentication",
            label: "Supabase service-role key",
            status: "red",
            detail: `Present, but its role claim reads ${serviceRole ?? "unreadable"} rather than service_role.`,
            remedy:
              "Privileged writes will fail silently under RLS. Copy the service_role key from Supabase → Settings → API.",
          },
  );

  return checks;
}

export function checkAppUrl(env: Env, requestOrigin: string | null): Check {
  const value = env.NEXT_PUBLIC_APP_URL;

  if (!value) {
    return {
      id: "app.url",
      group: "Environment",
      label: "App URL",
      status: "red",
      detail:
        "NEXT_PUBLIC_APP_URL is not set. Email links, Stripe return URLs, the sitemap and OG tags all build absolute URLs from it.",
      remedy: "Set it to the public origin, with no trailing slash.",
    };
  }
  if (!isAbsoluteHttpUrl(value)) {
    return {
      id: "app.url",
      group: "Environment",
      label: "App URL",
      status: "red",
      detail: "NEXT_PUBLIC_APP_URL is not an absolute http(s) URL.",
      remedy: "It must include the scheme, e.g. https://royalpal.app",
    };
  }

  const host = new URL(value).host;

  if (isProduction(env) && /^(localhost|127\.0\.0\.1)/.test(host)) {
    return {
      id: "app.url",
      group: "Environment",
      label: "App URL",
      status: "red",
      detail: `This is a production deployment but NEXT_PUBLIC_APP_URL points at ${host}. Every emailed link would send people to their own machine.`,
      remedy: "Set it to the real public origin.",
    };
  }

  // A mismatch is not cosmetic: Next.js rejects a Server Action POST whose
  // Origin does not match, so the whole write surface fails with an error
  // that says nothing about the cause.
  if (requestOrigin && new URL(requestOrigin).host !== host) {
    return {
      id: "app.url",
      group: "Environment",
      label: "App URL",
      status: "red",
      detail: `NEXT_PUBLIC_APP_URL is ${host} but this page was served from ${new URL(requestOrigin).host}. Server Actions reject cross-origin POSTs, so forms will fail.`,
      remedy: "Point NEXT_PUBLIC_APP_URL at the origin people actually use.",
    };
  }

  return {
    id: "app.url",
    group: "Environment",
    label: "App URL",
    status: "green",
    detail: `Set to ${host}, matching the origin serving this page.`,
  };
}

export function checkCronSecret(env: Env): Check {
  if (!present(env, "CRON_SECRET")) {
    return {
      id: "cron.secret",
      group: "Scheduled jobs",
      label: "Cron secret",
      status: "red",
      // Not yellow. Cron auth fails CLOSED, so an unset secret is not a
      // dormant feature — it is three jobs silently returning 503 forever.
      detail:
        "CRON_SECRET is not set, so every scheduled job returns 503. Lessons never complete, unpaid holds are never released, and reminders are never sent.",
      remedy: "Generate one with `openssl rand -base64 48` and set it in the hosting environment.",
    };
  }
  if ((env.CRON_SECRET ?? "").trim().length < 24) {
    return {
      id: "cron.secret",
      group: "Scheduled jobs",
      label: "Cron secret",
      status: "red",
      detail: "CRON_SECRET is set but shorter than 24 characters — short enough to be guessed.",
      remedy: "Replace it with `openssl rand -base64 48`.",
    };
  }
  return {
    id: "cron.secret",
    group: "Scheduled jobs",
    label: "Cron secret",
    status: "green",
    detail: "Set, and long enough. Jobs authorize with a constant-time comparison.",
  };
}

/**
 * Stripe.
 *
 * Unconfigured is YELLOW, always — it is this project's documented, deliberate
 * state, and the app degrades honestly without it. What IS red is a key that
 * does not match the environment it is deployed in.
 */
export function checkStripe(env: Env): Check[] {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  const webhook = env.STRIPE_WEBHOOK_SECRET?.trim();
  const production = isProduction(env);

  if (!secret) {
    return [
      {
        id: "stripe.keys",
        group: "Payments",
        label: "Stripe",
        status: "yellow",
        detail:
          "Intentionally not configured. Booking declines with a clear message before creating a row; everything else works.",
        remedy: "docs/STRIPE_TEST_MODE_VERIFICATION.md is the runbook for switching it on.",
      },
    ];
  }

  const checks: Check[] = [];
  const live = secret.startsWith("sk_live_");
  const test = secret.startsWith("sk_test_");

  if (!live && !test) {
    checks.push({
      id: "stripe.keys",
      group: "Payments",
      label: "Stripe secret key",
      status: "red",
      detail: "STRIPE_SECRET_KEY is set but is not an sk_live_ or sk_test_ key.",
      remedy: "Copy it again from Stripe → Developers → API keys.",
    });
  } else if (live && !production) {
    checks.push({
      id: "stripe.keys",
      group: "Payments",
      label: "Stripe secret key",
      status: "red",
      detail:
        "A LIVE Stripe key is set on a deployment that is not production. Test traffic here moves real money.",
      remedy: "Replace it with the sk_test_ key for this environment.",
    });
  } else if (test && production) {
    checks.push({
      id: "stripe.keys",
      group: "Payments",
      label: "Stripe secret key",
      status: "yellow",
      detail:
        "Production is running a TEST Stripe key. Checkout works and no real money moves — correct for a rehearsal, wrong for launch.",
      remedy: "Swap to the sk_live_ key when you are ready to take payments.",
    });
  } else {
    checks.push({
      id: "stripe.keys",
      group: "Payments",
      label: "Stripe secret key",
      status: "green",
      detail: `Set, ${live ? "live" : "test"} mode, matching this environment.`,
    });
  }

  checks.push(
    webhook
      ? {
          id: "stripe.webhook",
          group: "Payments",
          label: "Stripe webhook secret",
          status: "green",
          detail: "Set. Incoming events have their signature verified.",
        }
      : {
          id: "stripe.webhook",
          group: "Payments",
          label: "Stripe webhook secret",
          status: "red",
          // With a secret key but no webhook secret, students are charged and
          // nothing ever confirms their booking. That is the worst of the
          // three states, not a partial one.
          detail:
            "STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not. Payments would be taken and no booking would ever be confirmed, because confirmation happens on the webhook.",
          remedy:
            "Add the endpoint in Stripe → Developers → Webhooks and set its signing secret here.",
        },
  );

  checks.push(
    present(env, "STRIPE_ROYALPAL_PRODUCT_ID")
      ? {
          id: "stripe.product",
          group: "Payments",
          label: "Stripe product",
          status: "green",
          detail: "A RoyalPal-tagged product id is set.",
        }
      : {
          id: "stripe.product",
          group: "Payments",
          label: "Stripe product",
          status: "yellow",
          detail:
            "STRIPE_ROYALPAL_PRODUCT_ID is unset; checkout falls back to inline product data. This matters because the Stripe account is shared with another product.",
          remedy: "Create the product once and set its prod_… id. See the README.",
        },
  );

  return checks;
}

export function checkAlerting(env: Env): Check {
  return present(env, "ALERT_WEBHOOK_URL")
    ? {
        id: "alerts.webhook",
        group: "Observability",
        label: "Error alerting",
        status: "green",
        detail:
          "ALERT_WEBHOOK_URL is set. Alerts carry a field denylist, never a stack or a token.",
      }
    : {
        id: "alerts.webhook",
        group: "Observability",
        label: "Error alerting",
        status: "yellow",
        detail: "ALERT_WEBHOOK_URL is unset, so errors reach stdout and nobody else.",
        remedy: "Set it to a Slack or Discord incoming webhook before launch.",
      };
}

export function checkMeet(env: Env): Check {
  const keys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];
  const missing = keys.filter((key) => !present(env, key));

  if (missing.length === keys.length) {
    return {
      id: "meet.config",
      group: "Lessons",
      label: "Google Meet links",
      status: "yellow",
      detail:
        "Not configured. Bookings are created with meeting_status 'pending' and no link; everything else about the lesson works.",
      remedy: "See the README's Google Calendar section when you want automatic Meet rooms.",
    };
  }
  if (missing.length > 0) {
    return {
      id: "meet.config",
      group: "Lessons",
      label: "Google Meet links",
      status: "red",
      // Partial is worse than absent: the code takes the configured path and
      // fails on every booking instead of skipping cleanly.
      detail: `Partially configured — missing ${missing.join(", ")}. Link creation will be attempted and fail on every booking.`,
      remedy: "Set the missing variables, or clear all three to turn the feature off cleanly.",
    };
  }
  return {
    id: "meet.config",
    group: "Lessons",
    label: "Google Meet links",
    status: "green",
    detail: "All three credentials are set.",
  };
}

/** Every configuration check that needs nothing but the environment. */
export function environmentChecks(env: Env, requestOrigin: string | null): Check[] {
  return [
    ...checkSupabaseConfig(env),
    checkAppUrl(env, requestOrigin),
    checkCronSecret(env),
    ...checkStripe(env),
    checkAlerting(env),
    checkMeet(env),
  ];
}
