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

type Level = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

/** Turns an unknown thrown value into something safe to serialize. */
function serializeError(err: unknown): LogFields {
  if (err instanceof Error) {
    return { errorName: err.name, errorMessage: err.message, stack: err.stack };
  }
  return { errorMessage: String(err) };
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
