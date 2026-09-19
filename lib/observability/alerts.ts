/**
 * Error alerting.
 *
 * WHY THIS AND NOT A VENDOR SDK
 * Structured JSON to stdout is already captured by Vercel and greppable, which
 * is good enough for post-hoc investigation and useless for the thing that
 * actually matters at launch: finding out a webhook is failing before a tutor
 * tells you. This adds a push so that errors reach a human.
 *
 * It is transport-agnostic and DORMANT until configured — the same shape as
 * the email provider and the Stripe client, for the same reason: a deployment
 * with no alerting configured must behave normally rather than crash or
 * silently pretend.
 *
 * ALERT_WEBHOOK_URL accepts any JSON-ingesting endpoint; Slack and Discord
 * incoming webhooks both work as-is. Adding @sentry/nextjs later means
 * replacing `deliver` and nothing else, because every caller goes through
 * logger.error rather than through this file.
 *
 * WHAT IS DELIBERATELY NOT SENT
 * No request bodies, no tokens, no email addresses, no message content. An
 * alerting channel is usually the least-protected surface an organisation has
 * — a Slack channel half the company can read — and shipping user data into it
 * turns an outage into a disclosure. Only the message, the error name, the
 * component and the correlation ids travel.
 */

const REDACTED_KEYS = new Set([
  "stack",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "password",
  "email",
  "body",
  "payload",
  "secret",
  "key",
  "apiKey",
]);

export function isAlertingConfigured(): boolean {
  return Boolean(process.env.ALERT_WEBHOOK_URL);
}

/**
 * Strips anything that could carry personal data or a credential.
 *
 * An allowlist would be safer still, but it would also mean every new log
 * field is invisible until someone remembers to add it — which is how alerting
 * quietly becomes useless. A denylist plus a value-length cap keeps new fields
 * flowing while bounding the damage.
 */
export function safeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED_KEYS.has(key)) continue;
    if (typeof value === "string") {
      out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
    // Objects and arrays are dropped entirely: they are where nested payloads
    // hide, and a flattened blob is not worth the disclosure risk.
  }
  return out;
}

/**
 * Sends an alert. Never throws and never blocks the caller — an alerting
 * failure must not become the outage.
 */
export async function sendAlert(
  message: string,
  fields: Record<string, unknown> = {},
): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  const payload = {
    // Slack and Discord both render `text`; a generic collector gets the
    // structured fields alongside it.
    text: `🚨 RoyalPal: ${message}`,
    service: "royalpal",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    message,
    ...safeFields(fields),
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Bounded: an alerting endpoint that hangs must not hold a request open.
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Deliberately silent. Logging a failure to log would recurse, and the
    // original error is already on stdout where the host captured it.
  }
}
