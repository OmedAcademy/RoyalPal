import { describe, it, expect } from "vitest";
import {
  checkAlerting,
  checkAppUrl,
  checkCronSecret,
  checkMeet,
  checkStripe,
  checkSupabaseConfig,
  environmentChecks,
  isProduction,
  jwtRole,
  type Env,
} from "@/lib/diagnostics/env";

/** A syntactically real Supabase key carrying the given role. */
function key(role: string): string {
  const b64 = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role, iat: 1 })}.sig`;
}

const SOUND: Env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: key("anon"),
  SUPABASE_SERVICE_ROLE_KEY: key("service_role"),
  NEXT_PUBLIC_APP_URL: "https://royalpal.app",
  CRON_SECRET: "a".repeat(48),
  NODE_ENV: "production",
};

const find = (checks: ReturnType<typeof environmentChecks>, id: string) =>
  checks.find((check) => check.id === id)!;

describe("jwtRole", () => {
  it("reads the role claim out of a compact JWT", () => {
    expect(jwtRole(key("service_role"))).toBe("service_role");
    expect(jwtRole(key("anon"))).toBe("anon");
  });

  it("returns null rather than throwing on anything that is not a JWT", () => {
    expect(jwtRole(undefined)).toBeNull();
    expect(jwtRole("")).toBeNull();
    expect(jwtRole("not-a-jwt")).toBeNull();
    expect(jwtRole("a.b.c")).toBeNull();
  });
});

describe("Supabase configuration", () => {
  it("is green when all three values are present and carry the right roles", () => {
    const checks = checkSupabaseConfig(SOUND);
    expect(checks.every((check) => check.status === "green")).toBe(true);
  });

  it("is RED when the service-role key has been published as the anon key", () => {
    // The single worst mistake available here: the value ships to every
    // browser and every phone, and bypasses RLS entirely.
    const checks = checkSupabaseConfig({
      ...SOUND,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: key("service_role"),
    });
    const anon = checks.find((check) => check.id === "supabase.anon")!;
    expect(anon.status).toBe("red");
    expect(anon.detail).toMatch(/SERVICE-ROLE/);
    expect(anon.remedy).toMatch(/ROTATE/i);
  });

  it("is RED when the service-role slot holds a key that is not service_role", () => {
    const checks = checkSupabaseConfig({ ...SOUND, SUPABASE_SERVICE_ROLE_KEY: key("anon") });
    expect(checks.find((check) => check.id === "supabase.service")!.status).toBe("red");
  });

  it("never prints a key value", () => {
    const printed = checkSupabaseConfig(SOUND)
      .map((check) => `${check.detail} ${check.remedy ?? ""}`)
      .join(" ");
    expect(printed).not.toContain(SOUND.SUPABASE_SERVICE_ROLE_KEY);
    expect(printed).not.toContain(SOUND.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  });
});

describe("app URL", () => {
  it("is green when it matches the origin serving the page", () => {
    expect(checkAppUrl(SOUND, "https://royalpal.app").status).toBe("green");
  });

  it("is RED on a mismatch, because Server Actions reject cross-origin POSTs", () => {
    const check = checkAppUrl(SOUND, "https://preview.vercel.app");
    expect(check.status).toBe("red");
    expect(check.detail).toMatch(/Server Actions/);
  });

  it("is RED when production points at localhost", () => {
    expect(
      checkAppUrl({ ...SOUND, NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, null).status,
    ).toBe("red");
  });

  it("allows localhost when this is not production", () => {
    expect(
      checkAppUrl(
        { ...SOUND, NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
        "http://localhost:3000",
      ).status,
    ).toBe("green");
  });

  it("is RED when unset or not absolute", () => {
    expect(checkAppUrl({ ...SOUND, NEXT_PUBLIC_APP_URL: undefined }, null).status).toBe("red");
    expect(checkAppUrl({ ...SOUND, NEXT_PUBLIC_APP_URL: "royalpal.app" }, null).status).toBe("red");
  });
});

describe("cron secret", () => {
  it("is RED when unset, because cron auth fails closed", () => {
    // Not yellow. Unset does not mean "scheduled jobs are off" — it means all
    // three return 503 and lessons never complete.
    const check = checkCronSecret({ ...SOUND, CRON_SECRET: undefined });
    expect(check.status).toBe("red");
    expect(check.detail).toMatch(/503/);
  });

  it("is RED when set but trivially short", () => {
    expect(checkCronSecret({ ...SOUND, CRON_SECRET: "short" }).status).toBe("red");
  });

  it("is green when set and long", () => {
    expect(checkCronSecret(SOUND).status).toBe("green");
  });
});

describe("Stripe", () => {
  it("is YELLOW when unconfigured — the documented, deliberate state", () => {
    const checks = checkStripe(SOUND);
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe("yellow");
    expect(checks[0].detail).toMatch(/[Ii]ntentionally/);
  });

  it("is RED when a live key runs outside production", () => {
    const checks = checkStripe({
      ...SOUND,
      NODE_ENV: "development",
      STRIPE_SECRET_KEY: "sk_live_abcdefgh",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
    });
    const keyCheck = checks.find((check) => check.id === "stripe.keys")!;
    expect(keyCheck.status).toBe("red");
    expect(keyCheck.detail).toMatch(/real money/);
  });

  it("is YELLOW, not red, when production runs a test key", () => {
    const checks = checkStripe({
      ...SOUND,
      STRIPE_SECRET_KEY: "sk_test_abcdefgh",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
    });
    expect(checks.find((check) => check.id === "stripe.keys")!.status).toBe("yellow");
  });

  it("is RED when a secret key is set with no webhook secret", () => {
    // Worse than no Stripe at all: students are charged and no booking is
    // ever confirmed, because confirmation happens on the webhook.
    const checks = checkStripe({ ...SOUND, STRIPE_SECRET_KEY: "sk_live_abcdefgh" });
    const webhook = checks.find((check) => check.id === "stripe.webhook")!;
    expect(webhook.status).toBe("red");
    expect(webhook.detail).toMatch(/no booking would ever be confirmed/);
  });

  it("never prints a key value", () => {
    const secret = "sk_live_abcdefgh12345";
    const printed = checkStripe({
      ...SOUND,
      STRIPE_SECRET_KEY: secret,
      STRIPE_WEBHOOK_SECRET: "whsec_x",
    })
      .map((check) => `${check.detail} ${check.remedy ?? ""}`)
      .join(" ");
    expect(printed).not.toContain(secret);
  });
});

describe("Google Meet", () => {
  it("is YELLOW when none of the three credentials is set", () => {
    expect(checkMeet(SOUND).status).toBe("yellow");
  });

  it("is RED when only some are set, because partial is worse than absent", () => {
    const check = checkMeet({ ...SOUND, GOOGLE_CLIENT_ID: "id" });
    expect(check.status).toBe("red");
    expect(check.detail).toMatch(/GOOGLE_CLIENT_SECRET/);
    expect(check.detail).toMatch(/GOOGLE_REFRESH_TOKEN/);
  });

  it("is green when all three are set", () => {
    expect(
      checkMeet({
        ...SOUND,
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        GOOGLE_REFRESH_TOKEN: "token",
      }).status,
    ).toBe("green");
  });
});

describe("alerting", () => {
  it("is YELLOW without a webhook and green with one", () => {
    expect(checkAlerting(SOUND).status).toBe("yellow");
    expect(checkAlerting({ ...SOUND, ALERT_WEBHOOK_URL: "https://hooks.example" }).status).toBe(
      "green",
    );
  });
});

describe("isProduction", () => {
  it("prefers VERCEL_ENV over NODE_ENV", () => {
    // A Vercel preview builds with NODE_ENV=production, so trusting NODE_ENV
    // alone would call every preview deployment production and mis-grade the
    // live-Stripe-key check on the one place it matters.
    expect(isProduction({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(isProduction({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(true);
    expect(isProduction({ NODE_ENV: "production" })).toBe(true);
    expect(isProduction({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("the full environment sweep", () => {
  it("reports no red checks for a sound production configuration", () => {
    const checks = environmentChecks(SOUND, "https://royalpal.app");
    expect(checks.filter((check) => check.status === "red")).toEqual([]);
  });

  it("gives every check a stable id, so nothing is silently dropped", () => {
    const ids = environmentChecks(SOUND, null).map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(find(environmentChecks(SOUND, null), "cron.secret")).toBeDefined();
  });
});
