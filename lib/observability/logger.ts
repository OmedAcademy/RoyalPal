/**
 * Structured logging.
 *
 * Emits one JSON object per line to stdout/stderr. Every serverless host
 * (Vercel included) captures those streams, so this needs no external
 * service and no vendor SDK — but unlike bare console.error("msg", obj) the
 * output is machine-parseable, so logs can be filtered by field once a log
 * drain is attached later.
 *
 * Correlation is the point: `child()` returns a logger that carries context
 * forward, so every line emitted while handling one Stripe event shares a
 * `stripeEventId`, and every line touching one booking shares a `bookingId`.
 * That turns "a payment failed somewhere" into a single greppable trace.
 */

import { sendAlert } from "@/lib/observability/alerts";

type Level = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

/** Turns an unknown thrown value into something safe to serialize. */
/**
 * Turns whatever was thrown into fields an operator can act on.
 *
 * The `String(err)` fallback was the whole problem: PostgREST errors are plain
 * objects, not Errors, so every database failure in this codebase logged
 * "[object Object]". The user-facing message on those paths is deliberately
 * opaque, on the understanding that the operator can see the real thing — and
 * the operator could not.
 */
function serializeError(err: unknown): LogFields {
  if (err instanceof Error) {
    return { errorName: err.name, errorMessage: err.message, stack: err.stack };
  }

  if (err !== null && typeof err === "object") {
    // The four fields supabase-js carries. Read individually rather than
    // spread, so an error object cannot inject a `level` or a `time` into the
    // log line, and so a circular reference never reaches JSON.stringify.
    const e = err as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" ? value : undefined);
    return {
      errorMessage: text(e.message) ?? JSON.stringify(shallow(e)),
      errorCode: text(e.code),
      errorDetails: text(e.details),
      errorHint: text(e.hint),
    };
  }

  return { errorMessage: String(err) };
}

/** One level deep, primitives only — enough to identify an unfamiliar error
 * shape without risking a cycle. */
function shallow(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || typeof entry !== "object") out[key] = entry;
  }
  return out;
}

export type Logger = {
  child(fields: LogFields): Logger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, err?: unknown, fields?: LogFields): void;
};

function write(level: Level, base: LogFields, message: string, fields?: LogFields): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...base,
    ...fields,
  });

  // Route by severity so host log levels and alerting work correctly.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  // Errors are also pushed to whoever is on call. Fire-and-forget, and
  // redacted — see lib/observability/alerts.ts for what is deliberately not
  // sent. Dormant unless ALERT_WEBHOOK_URL is set, so nothing changes for a
  // deployment that has not configured it.
  if (level === "error") {
    void sendAlert(message, { ...base, ...fields });
  }
}

export function createLogger(base: LogFields = {}): Logger {
  return {
    child: (fields) => createLogger({ ...base, ...fields }),
    debug: (m, f) => write("debug", base, m, f),
    info: (m, f) => write("info", base, m, f),
    warn: (m, f) => write("warn", base, m, f),
    error: (m, err, f) => write("error", base, m, { ...(err ? serializeError(err) : {}), ...f }),
  };
}

/** Root logger. Prefer a `child()` with request/entity context at call sites. */
export const logger = createLogger({ service: "royalpal" });

/** Correlation id for a single inbound request. */
export function newRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}
