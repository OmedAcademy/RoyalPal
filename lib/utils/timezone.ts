// One formatter per zone: constructing Intl.DateTimeFormat is far more
// expensive than using it, and slot generation probes offsets hundreds of
// times per request.
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23", // never "24:xx"
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

/** The zone's UTC offset (ms to ADD to a wall-clock-as-UTC guess) measured
 * at a specific instant.
 *
 * Deliberately built from formatToParts + Date.UTC, NOT by re-parsing
 * toLocaleString output with `new Date(string)`: that parse runs in the
 * HOST machine's timezone, so the measured offset silently corrupts
 * whenever the rendered strings straddle one of the host zone's own DST
 * transitions (observed concretely: America/New_York offsets came back
 * wrong by an hour on a Los Angeles host, because Mar 8 is LA's
 * spring-forward day too). This construction touches only the target zone
 * and UTC — the host timezone can never influence the result. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const v: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") v[p.type] = Number(p.value);
  }
  const wallAsUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return instant.getTime() - wallAsUtc;
}

/** date: "YYYY-MM-DD", time: "HH:MM" (24h), both wall-clock values in `timeZone`.
 * Returns the UTC instant they correspond to.
 *
 * Two-pass offset correction: measure the zone offset at the naive guess,
 * correct, then re-measure at the corrected instant and correct again. The
 * second pass matters on DST-transition days — with a single pass, a
 * wall-clock time whose naive guess lands on the other side of the
 * transition gets the outgoing offset and comes back a full hour wrong
 * (e.g. 06:00 America/New_York on a spring-forward day resolved to 07:00).
 * For times whose offset is stable, the second pass is a no-op.
 *
 * Nonexistent wall-clock times (inside the spring-forward gap) resolve to
 * the instant after the jump; ambiguous fall-back times resolve to their
 * first occurrence. Both are deterministic. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const naiveUtc = new Date(`${date}T${time}:00Z`);

  const o1 = offsetAt(naiveUtc, timeZone);
  const first = new Date(naiveUtc.getTime() + o1);
  const o2 = offsetAt(first, timeZone);
  if (o1 === o2) return first; // offset stable — the common case

  // Offsets disagree: the naive guess and the candidate straddle a DST
  // transition. Re-correct with the candidate's offset; if THAT offset is
  // stable, it's the true instant (wall-clock time exists on the incoming
  // offset). If it's still unstable, the wall-clock time sits inside the
  // spring-forward gap and doesn't exist — keep `first`, which lands just
  // after the jump.
  const second = new Date(naiveUtc.getTime() + o2);
  return offsetAt(second, timeZone) === o2 ? second : first;
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
