/** date: "YYYY-MM-DD", time: "HH:MM" (24h), both wall-clock values in `timeZone`.
 * Returns the UTC instant they correspond to.
 *
 * Works by treating the wall-clock value as if it were UTC, then measuring
 * how far that guess is from the same instant rendered in `timeZone` and
 * correcting by the difference. Accurate to the minute; doesn't need a
 * timezone database dependency since it relies on the environment's own
 * Intl/ICU data via toLocaleString. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const naiveUtc = new Date(`${date}T${time}:00Z`);

  const tzString = naiveUtc.toLocaleString("en-US", { timeZone });
  const utcString = naiveUtc.toLocaleString("en-US", { timeZone: "UTC" });

  const offsetMs = new Date(utcString).getTime() - new Date(tzString).getTime();

  return new Date(naiveUtc.getTime() + offsetMs);
}

/** Inverse of zonedTimeToUtc: renders a UTC instant as {date, time} wall-clock
 * values in `timeZone`. */
export function utcToZonedParts(
  instant: Date,
  timeZone: string,
): { date: string; time: string; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    dayOfWeek: weekdayMap[get("weekday")] ?? 0,
  };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatSlotLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}
