import "server-only";
import { headers } from "next/headers";
import { environmentChecks, type Check, type CheckStatus } from "@/lib/diagnostics/env";
import {
  checkAdmins,
  checkDatabase,
  checkDelivery,
  checkMigrations,
  checkPublicRoutes,
  checkStorage,
} from "@/lib/diagnostics/runtime";

export type { Check, CheckStatus } from "@/lib/diagnostics/env";

export type Report = {
  checks: Check[];
  counts: Record<CheckStatus, number>;
  ranAt: string;
  /** True when nothing is red: safe to proceed, gaps and all. */
  ok: boolean;
};

/** The origin this deployment is being served from, for the self-fetches. */
async function requestOrigin(): Promise<string | null> {
  const headerStore = await headers();
  const host = headerStore.get("host");
  if (!host) return null;
  const proto =
    headerStore.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Runs every check and sorts the answer worst-first.
 *
 * Each group is allowed to fail independently: a database that cannot be
 * reached must not stop the page reporting that CRON_SECRET is missing too.
 * A diagnostics page that itself throws on the first problem tells you one
 * thing per visit, which is the opposite of what it is for.
 */
export async function runDiagnostics(): Promise<Report> {
  const origin = await requestOrigin();

  const settled = await Promise.allSettled([
    Promise.resolve(environmentChecks(process.env, origin)),
    checkDatabase(),
    checkMigrations(),
    checkStorage().then((check) => [check]),
    checkAdmins().then((check) => [check]),
    checkPublicRoutes(origin),
    Promise.resolve(checkDelivery()),
  ]);

  const checks: Check[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      checks.push(...result.value);
      return;
    }
    checks.push({
      id: `diagnostics.group-${index}`,
      group: "Diagnostics",
      label: "A check group failed to run",
      status: "red",
      detail:
        result.reason instanceof Error
          ? result.reason.message
          : "A group of checks threw before returning.",
    });
  });

  const order: Record<CheckStatus, number> = { red: 0, yellow: 1, green: 2 };
  checks.sort((a, b) => order[a.status] - order[b.status] || a.group.localeCompare(b.group));

  const counts: Record<CheckStatus, number> = { green: 0, yellow: 0, red: 0 };
  for (const check of checks) counts[check.status] += 1;

  return { checks, counts, ranAt: new Date().toISOString(), ok: counts.red === 0 };
}
