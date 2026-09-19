/** Formats a minor-unit amount (cents) as a localized currency string. */
export function formatMoney(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

/** Short calendar date, e.g. "Jul 22, 2026". */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/** Date + time, e.g. "Jul 22, 2026, 3:40 PM". */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * Date + time rendered in an EXPLICIT IANA zone.
 *
 * The functions above deliberately keep their existing signatures — they are
 * used for administrative timestamps where the server's own reading is fine —
 * but anything a student or tutor reads as "when is my lesson" must name the
 * zone it is rendering in. On a server that zone is UTC, so an unqualified
 * Intl call silently tells a lesson at 19:00 in Berlin that it is at 17:00.
 */
export function formatDateTimeIn(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatTimeIn(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatDateIn(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/**
 * A short zone label to print next to a time ("19:00 CEST"), so a reader can
 * tell at a glance whose clock they are looking at. Falls back to the IANA
 * name if the runtime has no short name for it.
 */
export function timeZoneLabel(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(
    typeof iso === "string" ? new Date(iso) : iso,
  );
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * "just now" / "4m" / "3h" / "Tue" / "12 Mar" — the compact stamp a message
 * list needs. Absolute dates past a week because "8 days ago" is harder to
 * read than the date itself.
 */
export function formatRelativeShort(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(then);
  }
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(then);
}
