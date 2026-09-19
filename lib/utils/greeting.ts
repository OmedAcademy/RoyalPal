/** Time-of-day greeting in the given IANA timezone.
 *
 * `hourCycle: "h23"` rather than `hour12: false` for the reason spelled out in
 * utcToZonedParts: where the locale prefers h24, midnight reads back as hour
 * 24, and 24 fails both `< 12` and `< 18` — so the whole midnight-to-01:00
 * hour greeted students and tutors with "Good evening". */
export function greeting(timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
