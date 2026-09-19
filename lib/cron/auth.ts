import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "cron" });

/**
 * Authorizes a scheduled-job request.
 *
 * These endpoints mutate platform-wide state — completing lessons, expiring
 * bookings, anonymising accounts — so they are exactly as sensitive as an
 * admin action and are protected the same way: a shared secret, compared in
 * constant time.
 *
 * WHY NOT TRUST THE VERCEL CRON HEADER ALONE
 * Vercel sends `x-vercel-cron` on scheduled invocations, but a header is not
 * an authenticator: anyone who can reach the URL can send it. The secret is
 * what actually gates the route; the header is only used to label the caller
 * in logs.
 *
 * FAILS CLOSED, unlike the rate limiter. An unconfigured CRON_SECRET refuses
 * every request rather than allowing them, because the downside is inverted
 * here — a missed sweep is a delay, while an open sweep endpoint is a stranger
 * able to cancel every pending booking on the platform.
 */
export function authorizeCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    log.error("CRON_SECRET is not set; refusing", new Error("cron_secret_missing"));
    return NextResponse.json({ error: "Scheduled jobs are not configured" }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!constantTimeEquals(provided, secret)) {
    log.error("unauthorized cron attempt", new Error("cron_unauthorized"), {
      hadHeader: header.length > 0,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Length is compared first and separately because timingSafeEqual throws on a
 * length mismatch rather than returning false. Comparing hashes of both sides
 * would also work; this is simpler and leaks only the length, which an
 * attacker who is guessing a secret already has cheaper ways to learn.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type JobResult = Record<string, number | string | boolean>;

/**
 * Wraps a job so every one of them reports the same shape, logs its own
 * duration, and never leaks a stack trace to the caller.
 *
 * Returns 200 with `ok: false` rather than a 5xx on a handled failure: the
 * scheduler's retry is welcome, but an alert that fires on HTTP status alone
 * would be unable to tell "the sweep found nothing to do" from "the sweep
 * could not run", and both are worth different reactions.
 */
export async function runJob(
  name: string,
  handler: () => Promise<JobResult>,
): Promise<NextResponse> {
  const startedAt = Date.now();
  const jobLog = logger.child({ component: "cron", job: name });

  try {
    const result = await handler();
    const durationMs = Date.now() - startedAt;
    jobLog.info("job completed", { ...result, durationMs });
    return NextResponse.json({ ok: true, job: name, durationMs, ...result });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    jobLog.error("job failed", err, { durationMs });
    return NextResponse.json({ ok: false, job: name, durationMs }, { status: 500 });
  }
}
