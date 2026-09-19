import { describe, it, expect } from "vitest";
import { zonedTimeToUtc, utcToZonedParts, addDays } from "@/lib/utils/timezone";

/**
 * Booking correctness lives or dies on this module: every slot a student can
 * buy is produced by zonedTimeToUtc. These tests pin known wall-clock↔UTC
 * mappings (independently derivable from the IANA tz database), DST
 * transition behaviour, and round-trip identity.
 *
 * 2026 DST facts used below (America/New_York): spring forward on Sun
 * Mar 8 (02:00 EST → 03:00 EDT, i.e. 07:00Z); fall back on Sun Nov 1
 * (02:00 EDT → 01:00 EST, i.e. 06:00Z).
 */

describe("zonedTimeToUtc — fixed-offset and no-DST zones", () => {
  it("maps UTC wall-clock to the same instant", () => {
    expect(zonedTimeToUtc("2026-07-15", "10:00", "UTC").toISOString()).toBe(
      "2026-07-15T10:00:00.000Z",
    );
  });

  it("maps Tokyo (+09:00, no DST) correctly", () => {
    expect(zonedTimeToUtc("2026-07-15", "10:00", "Asia/Tokyo").toISOString()).toBe(
      "2026-07-15T01:00:00.000Z",
    );
  });

  it("handles non-hour offsets (Kathmandu +05:45)", () => {
    expect(zonedTimeToUtc("2026-07-15", "10:00", "Asia/Kathmandu").toISOString()).toBe(
      "2026-07-15T04:15:00.000Z",
    );
  });
});

describe("zonedTimeToUtc — DST zones away from transitions", () => {
  it("New York winter (EST, -05:00)", () => {
    expect(zonedTimeToUtc("2026-01-15", "10:00", "America/New_York").toISOString()).toBe(
      "2026-01-15T15:00:00.000Z",
    );
  });

  it("New York summer (EDT, -04:00)", () => {
    expect(zonedTimeToUtc("2026-07-15", "10:00", "America/New_York").toISOString()).toBe(
      "2026-07-15T14:00:00.000Z",
    );
  });

  it("London summer (BST, +01:00)", () => {
    expect(zonedTimeToUtc("2026-07-01", "10:00", "Europe/London").toISOString()).toBe(
      "2026-07-01T09:00:00.000Z",
    );
  });

  it("Sydney (southern hemisphere: DST in January, +11:00)", () => {
    expect(zonedTimeToUtc("2026-01-15", "10:00", "Australia/Sydney").toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
  });
});

describe("zonedTimeToUtc — DST transition days (the bug class)", () => {
  it("early morning BEFORE the spring-forward jump uses the outgoing offset", () => {
    // 01:30 EST on Mar 8 2026 exists (jump happens at 02:00 local).
    expect(zonedTimeToUtc("2026-03-08", "01:30", "America/New_York").toISOString()).toBe(
      "2026-03-08T06:30:00.000Z",
    );
  });

  it("morning AFTER the spring-forward jump uses the incoming offset (regression: was 1h late)", () => {
    // 06:00 EDT on Mar 8 2026 = 10:00Z. The old single-pass implementation
    // measured the offset at the naive guess 06:00Z (still EST, -5) and
    // returned 11:00Z — a lesson displayed at 6am that actually started at 7.
    expect(zonedTimeToUtc("2026-03-08", "06:00", "America/New_York").toISOString()).toBe(
      "2026-03-08T10:00:00.000Z",
    );
  });

  it("nonexistent wall-clock time (inside the gap) resolves deterministically after the jump", () => {
    // 02:30 local never happens on Mar 8 2026; clocks jump 02:00 -> 03:00.
    const result = zonedTimeToUtc("2026-03-08", "02:30", "America/New_York");
    expect(result.toISOString()).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
  });

  it("fall-back day: post-transition morning uses standard time again", () => {
    // 09:00 on Nov 1 2026 (after 02:00 EDT -> 01:00 EST) = 14:00Z.
    expect(zonedTimeToUtc("2026-11-01", "09:00", "America/New_York").toISOString()).toBe(
      "2026-11-01T14:00:00.000Z",
    );
  });

  it("ambiguous fall-back time resolves to its first occurrence", () => {
    // 01:30 happens twice on Nov 1 2026; first occurrence is EDT (05:30Z).
    expect(zonedTimeToUtc("2026-11-01", "01:30", "America/New_York").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });
});

describe("round-trip identity (zonedTimeToUtc ∘ utcToZonedParts)", () => {
  const cases: [string, string, string][] = [
    ["2026-01-15", "10:00", "America/New_York"],
    ["2026-07-15", "23:30", "America/New_York"],
    ["2026-03-08", "09:00", "America/New_York"], // spring-forward day
    ["2026-11-01", "09:00", "America/New_York"], // fall-back day
    ["2026-07-15", "00:00", "Asia/Tokyo"],
    ["2026-02-10", "18:45", "Asia/Kathmandu"],
    ["2026-06-21", "08:00", "Europe/London"],
    ["2026-01-15", "10:00", "Australia/Sydney"],
    ["2026-08-01", "13:00", "Asia/Baghdad"],
  ];

  for (const [date, time, tz] of cases) {
    it(`${date} ${time} ${tz}`, () => {
      const instant = zonedTimeToUtc(date, time, tz);
      const parts = utcToZonedParts(instant, tz);
      expect(`${parts.date} ${parts.time}`).toBe(`${date} ${time}`);
    });
  }
});

describe("utcToZonedParts", () => {
  it("returns the local calendar date when it differs from the UTC date", () => {
    // 23:30Z Jul 14 = 08:30 Jul 15 in Tokyo.
    const parts = utcToZonedParts(new Date("2026-07-14T23:30:00Z"), "Asia/Tokyo");
    expect(parts.date).toBe("2026-07-15");
    expect(parts.time).toBe("08:30");
    expect(parts.dayOfWeek).toBe(3); // Wednesday
  });
});

describe("utcToZonedParts — midnight is 00:00, never 24:00", () => {
  /**
   * Regression: the formatter used `hour12: false`, which only asks for *a*
   * 24-hour cycle and lets the locale pick between h23 (00..23) and h24
   * (01..24). On the ICU shipped with Node 20 (CI) en-CA picks h24, so
   * midnight came back as "24:00"; Node 22's newer ICU always picks h23, so
   * the bug was invisible locally and only ever failed in CI.
   *
   * Only `time` was affected — the date part stayed on the correct day — and
   * today's single production caller reads `date` alone, so nothing user-facing
   * was broken. What broke is the contract this function exists to provide:
   * being the exact inverse of zonedTimeToUtc. The next caller to read `time`
   * (an availability rule keyed "00:00", a slot label) is the one that would
   * have paid for it.
   */
  const midnightCases: [string, string][] = [
    ["Asia/Tokyo", "2026-07-14T15:00:00Z"], // +09:00 → Jul 15 00:00
    ["UTC", "2026-07-15T00:00:00Z"],
    ["America/New_York", "2026-07-15T04:00:00Z"], // -04:00 → Jul 15 00:00
    ["Asia/Kathmandu", "2026-07-14T18:15:00Z"], // +05:45 → Jul 15 00:00
    ["Australia/Sydney", "2026-07-14T14:00:00Z"], // +10:00 → Jul 15 00:00
  ];

  for (const [tz, instant] of midnightCases) {
    it(`${tz} midnight renders as 2026-07-15 00:00`, () => {
      const parts = utcToZonedParts(new Date(instant), tz);
      expect(`${parts.date} ${parts.time}`).toBe("2026-07-15 00:00");
    });
  }

  it("never emits an hour outside 00-23 across a full day in every tested zone", () => {
    for (const [tz] of midnightCases) {
      for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
        const instant = new Date(Date.UTC(2026, 6, 15) + minutes * 60_000);
        const hour = Number(utcToZonedParts(instant, tz).time.slice(0, 2));
        expect(hour, `${tz} at +${minutes}min`).toBeLessThanOrEqual(23);
        expect(hour, `${tz} at +${minutes}min`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("addDays", () => {
  it("adds across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles leap years", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
