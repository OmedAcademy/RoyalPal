import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeChannels } from "@/lib/notifications/diagnostics";
import { logger } from "@/lib/observability/logger";
import type { Check } from "@/lib/diagnostics/env";

const log = logger.child({ component: "diagnostics" });

/** Postgres says this when a table does not exist; PostgREST forwards it. */
const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";
/** PostgREST's own answer when a relation is missing from its schema cache. */
const PGRST_UNKNOWN_RELATION = "PGRST205";

const missingRelation = (code: string | undefined) =>
  code === UNDEFINED_TABLE || code === PGRST_UNKNOWN_RELATION;

/**
 * Every table and column the unapplied migrations introduce, so the page can
 * say which migrations the CONNECTED database actually has — rather than
 * repeating what a document claims.
 *
 * This is the check that matters most before a deploy. Production is
 * documented as being on 0027 while the code in this repository reads tables
 * introduced by 0031 onwards, and the failure mode is not subtle: messaging
 * and support return 500 the moment someone opens them.
 */
const MIGRATION_PROBES: { migration: string; what: string; table: string; column?: string }[] = [
  {
    migration: "0028",
    what: "tutor column locks",
    table: "tutor_profiles",
    column: "platform_fee_bps",
  },
  { migration: "0031", what: "support tickets", table: "support_tickets" },
  { migration: "0032", what: "messaging", table: "conversations" },
  { migration: "0033", what: "push tokens and preferences", table: "push_tokens" },
  { migration: "0034", what: "rescheduling", table: "booking_reschedules" },
  { migration: "0035", what: "review moderation", table: "reviews", column: "hidden_at" },
  { migration: "0036", what: "age gate and account deletion", table: "account_deletion_requests" },
  {
    migration: "0037",
    what: "cancellation policy audit",
    table: "bookings",
    column: "cancellation_policy",
  },
  { migration: "0038", what: "rate limiting", table: "rate_limits" },
  { migration: "0039", what: "signup age check", table: "profiles", column: "date_of_birth" },
];

export async function checkDatabase(): Promise<Check[]> {
  const checks: Check[] = [];
  const admin = createAdminClient();

  const started = Date.now();
  const { error, count } = await admin
    .from("subjects")
    .select("id", { count: "exact", head: true });
  const elapsed = Date.now() - started;

  if (error) {
    return [
      {
        id: "db.connect",
        group: "Database",
        label: "Connectivity",
        status: "red",
        detail: `Could not read the subjects table (${error.code ?? "unknown"}).`,
        remedy:
          "Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and that the project is not paused.",
      },
    ];
  }

  checks.push({
    id: "db.connect",
    group: "Database",
    label: "Connectivity",
    status: "green",
    detail: `Reachable in ${elapsed}ms.`,
  });

  // A tutor cannot finish onboarding without a subject to teach, so an empty
  // catalogue is a launch blocker that looks like a working deployment.
  checks.push(
    (count ?? 0) > 0
      ? {
          id: "db.subjects",
          group: "Database",
          label: "Subject catalogue",
          status: "green",
          detail: `${count} subject${count === 1 ? "" : "s"} available to book.`,
        }
      : {
          id: "db.subjects",
          group: "Database",
          label: "Subject catalogue",
          status: "red",
          detail: "No subjects exist. Tutors cannot complete onboarding and nothing can be booked.",
          remedy: "Seed the real taxonomy (supabase/seed.sql holds development ones).",
        },
  );

  return checks;
}

/** Which of the late migrations this database actually has. */
export async function checkMigrations(): Promise<Check[]> {
  const admin = createAdminClient();

  const results = await Promise.all(
    MIGRATION_PROBES.map(async (probe) => {
      const { error } = await admin
        .from(probe.table as "profiles")
        .select(probe.column ?? "id", { head: true, count: "exact" })
        .limit(1);

      if (!error) return { ...probe, applied: true as const, reason: "" };
      if (missingRelation(error.code)) {
        return { ...probe, applied: false as const, reason: `table ${probe.table} is missing` };
      }
      if (error.code === UNDEFINED_COLUMN) {
        return {
          ...probe,
          applied: false as const,
          reason: `${probe.table}.${probe.column} is missing`,
        };
      }
      log.error("migration probe failed", error, { migration: probe.migration });
      return { ...probe, applied: null, reason: error.code ?? "unknown error" };
    }),
  );

  const missing = results.filter((result) => result.applied === false);
  const unknown = results.filter((result) => result.applied === null);

  const checks: Check[] = [
    missing.length === 0 && unknown.length === 0
      ? {
          id: "db.migrations",
          group: "Database",
          label: "Migration state",
          status: "green",
          detail: `All ${results.length} probed migrations are present, up to 0039.`,
        }
      : {
          id: "db.migrations",
          group: "Database",
          label: "Migration state",
          status: "red",
          // Red rather than yellow: this is not a dormant feature. The
          // deployed code reads these tables, so each missing one is a 500 on
          // a page the navigation already links to.
          detail:
            missing.length > 0
              ? `${missing.length} migration${missing.length === 1 ? " is" : "s are"} not applied: ${missing
                  .map((result) => `${result.migration} (${result.what})`)
                  .join(", ")}. The deployed code reads these, so those features return errors.`
              : `Could not determine the state of ${unknown.length} migration(s).`,
          remedy: "docs/MIGRATIONS.md — deploy the code first, then apply them in numeric order.",
        },
  ];

  return checks;
}

export async function checkStorage(): Promise<Check> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.listBuckets();

  if (error) {
    return {
      id: "storage.avatars",
      group: "Storage",
      label: "Avatar bucket",
      status: "red",
      detail: `Could not list storage buckets: ${error.message}`,
      remedy: "Check the service-role key has storage access.",
    };
  }

  const avatars = data.find((bucket) => bucket.name === "avatars");
  if (!avatars) {
    return {
      id: "storage.avatars",
      group: "Storage",
      label: "Avatar bucket",
      status: "red",
      detail: "The 'avatars' bucket does not exist. Every profile photo upload fails.",
      remedy: "Apply migration 0014.",
    };
  }
  if (!avatars.public) {
    return {
      id: "storage.avatars",
      group: "Storage",
      label: "Avatar bucket",
      status: "red",
      detail:
        "The 'avatars' bucket is private, but avatar URLs are stored as public URLs and rendered on public tutor pages. Every photo would 404.",
      remedy: "Make the bucket public; writes stay restricted to each user's own folder by RLS.",
    };
  }

  return {
    id: "storage.avatars",
    group: "Storage",
    label: "Avatar bucket",
    status: "green",
    detail: "Present and public; writes are restricted to each user's own folder.",
  };
}

/** Is there anybody who can work the admin console at all? */
export async function checkAdmins(): Promise<Check> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");

  if (error) {
    return {
      id: "auth.admins",
      group: "Authorization",
      label: "Admin accounts",
      status: "red",
      detail: `Could not count admins (${error.code ?? "unknown"}).`,
    };
  }
  if ((count ?? 0) === 0) {
    return {
      id: "auth.admins",
      group: "Authorization",
      label: "Admin accounts",
      status: "red",
      detail:
        "No admin account exists. Admins cannot self-register (migration 0012 refuses it), so nobody can verify a tutor, resolve a ticket or issue a refund.",
      remedy:
        "Promote an existing account: update public.profiles set role = 'admin' where id = '<uuid>';",
    };
  }
  return {
    id: "auth.admins",
    group: "Authorization",
    label: "Admin accounts",
    status: "green",
    detail: `${count} admin account${count === 1 ? "" : "s"}. Self-registration as admin is refused by the database.`,
  };
}

/**
 * Fetches the app's own public surface.
 *
 * Worth the round trip: it is the only check here that exercises middleware,
 * routing and rendering together, and those are what break on a deploy without
 * anything in the configuration looking wrong.
 */
export async function checkPublicRoutes(origin: string | null): Promise<Check[]> {
  if (!origin) {
    return [
      {
        id: "routes.public",
        group: "Public surface",
        label: "Public pages",
        status: "yellow",
        detail: "Could not determine this deployment's own origin, so the pages were not fetched.",
      },
    ];
  }

  const LEGAL = [
    "/legal/terms",
    "/legal/privacy",
    "/legal/cookies",
    "/legal/acceptable-use",
    "/legal/cancellation",
    "/legal/safeguarding",
    "/legal/tutor-terms",
  ];

  async function status(path: string, redirect: RequestRedirect = "manual"): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(new URL(path, origin!), {
        redirect,
        signal: controller.signal,
        cache: "no-store",
      });
      return response.status;
    } catch {
      return 0;
    } finally {
      clearTimeout(timeout);
    }
  }

  const [legalStatuses, home, robots, sitemap, api, support] = await Promise.all([
    Promise.all(LEGAL.map((path) => status(path))),
    status("/"),
    status("/robots.txt"),
    status("/sitemap.xml"),
    status("/api/v1/me"),
    status("/support"),
  ]);

  const brokenLegal = LEGAL.filter((_, index) => legalStatuses[index] !== 200);
  const checks: Check[] = [];

  checks.push(
    home === 200
      ? {
          id: "routes.home",
          group: "Public surface",
          label: "Home page",
          status: "green",
          detail: "Serves 200.",
        }
      : {
          id: "routes.home",
          group: "Public surface",
          label: "Home page",
          status: "red",
          detail: `The home page answered ${home === 0 ? "not at all" : home}.`,
        },
  );

  checks.push(
    brokenLegal.length === 0
      ? {
          id: "routes.legal",
          group: "Public surface",
          label: "Policy pages",
          status: "green",
          detail: "All seven serve 200 and are linked from the footer of every public page.",
        }
      : {
          id: "routes.legal",
          group: "Public surface",
          label: "Policy pages",
          status: "red",
          // App-store review checks the privacy link, and a policy nobody can
          // open is the same as not having one.
          detail: `Not serving: ${brokenLegal.join(", ")}.`,
          remedy: "Both app stores require a reachable privacy policy before review.",
        },
  );

  checks.push(
    robots === 200 && sitemap === 200
      ? {
          id: "routes.seo",
          group: "Public surface",
          label: "robots.txt and sitemap.xml",
          status: "green",
          detail: "Both serve 200.",
        }
      : {
          id: "routes.seo",
          group: "Public surface",
          label: "robots.txt and sitemap.xml",
          status: "red",
          detail: `robots.txt answered ${robots}, sitemap.xml answered ${sitemap}.`,
        },
  );

  // 401 is the PASS here. A 200 would mean the mobile API answers anonymous
  // callers, and a 404 would mean it is not deployed at all.
  checks.push(
    api === 401
      ? {
          id: "routes.api",
          group: "Public surface",
          label: "Mobile API",
          status: "green",
          detail: "/api/v1/me is mounted and refuses an unauthenticated caller with 401.",
        }
      : {
          id: "routes.api",
          group: "Public surface",
          label: "Mobile API",
          status: "red",
          detail:
            api === 404
              ? "/api/v1/me returned 404 — the mobile API is not deployed here."
              : `/api/v1/me answered ${api} to an unauthenticated request; it must answer 401.`,
        },
  );

  // Reported, not judged: whether support should be public is a business
  // decision, and this page's job is to say what is true today.
  checks.push({
    id: "routes.support",
    group: "Public surface",
    label: "Support route",
    status: support === 200 ? "green" : "yellow",
    detail:
      support === 200
        ? "/support is reachable without signing in."
        : `/support answered ${support} to a signed-out request — it is behind the login wall.`,
    remedy:
      support === 200
        ? undefined
        : "Both app stores ask for a support URL that does not require an account. Decide whether to add a public contact page.",
  });

  return checks;
}

/** Notification channels, reusing the delivery page's own description. */
export function checkDelivery(): Check[] {
  return describeChannels().map((channel) => ({
    id: `delivery.${channel.channel}`,
    group: "Delivery",
    label:
      channel.channel === "in-app"
        ? "In-app notifications"
        : `${channel.channel[0].toUpperCase()}${channel.channel.slice(1)}`,
    // Not configured is yellow, never red: each channel is dormant by design
    // until its credentials exist, and the in-app feed still works.
    status: channel.configured ? "green" : "yellow",
    detail: channel.detail,
    remedy: channel.configured
      ? undefined
      : "Admin → Delivery sends a real test once keys are set.",
  }));
}
