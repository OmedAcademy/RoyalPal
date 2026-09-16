import { describe, it, expect } from "vitest";
import { computeAvailableSlots } from "@/lib/utils/availability-slots";

/**
 * The slot engine: recurring weekly rules + one-off exceptions − existing
 * bookings, on a 30-minute grid, in the tutor's timezone. Every bookable
 * slot a student ever sees comes out of this function.
 *
 * Baseline used throughout: startDate 2026-07-13 (a Monday), UTC timezone
 * (wall clock == UTC, so expectations are directly readable), `now` pinned
 * well before the window so future-filtering doesn't interfere.
 */

const NOW = new Date("2026-07-01T00:00:00Z");
const MONDAY = "2026-07-13";

const base = {
  exceptions: [],
  busyRanges: [],
  timeZone: "UTC",
  startDate: MONDAY,
  days: 1,
  durationMinutes: 60,
  now: NOW,
};

const iso = (s: { startAt: Date }) => s.startAt.toISOString();

describe("basic generation", () => {
  it("generates 30-min-grid start times that fit inside the window", () => {
    const slots = computeAvailableSlots({
      ...base,
      rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }],
    });
    // 60-min lessons in 09:00–11:00: starts at 09:00, 09:30, 10:00.
    expect(slots.map(iso)).toEqual([
      "2026-07-13T09:00:00.000Z",
      "2026-07-13T09:30:00.000Z",
      "2026-07-13T10:00:00.000Z",
    ]);
  });

  it("respects lesson duration (30-min lessons fit one extra start)", () => {
    const slots = computeAvailableSlots({
      ...base,
      durationMinutes: 30,
      rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }],
    });
    expect(slots).toHaveLength(4); // 09:00 09:30 10:00 10:30
  });

  it("returns nothing when the rule's weekday never occurs in the window", () => {
    const slots = computeAvailableSlots({
      ...base,
      rules: [{ day_of_week: 5, start_time: "09:00", end_time: "11:00" }], // Friday
    });
    expect(slots).toEqual([]);
  });

  it("applies a rule on every matching weekday across a multi-week window", () => {
    const slots = computeAvailableSlots({
      ...base,
      days: 14,
      rules: [{ day_of_week: 1, start_time: "09:00", end_time: "10:00" }],
    });
    expect(slots.map(iso)).toEqual(["2026-07-13T09:00:00.000Z", "2026-07-20T09:00:00.000Z"]);
  });

  it("a window too short for the duration yields nothing", () => {
    const slots = computeAvailableSlots({
      ...base,
      rules: [{ day_of_week: 1, start_time: "09:00", end_time: "09:45" }],
    });
    expect(slots).toEqual([]);
  });
});

describe("busy-range overlap exclusion", () => {
  const rules = [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }];

  it("removes any slot that overlaps an existing booking", () => {
    const slots = computeAvailableSlots({
      ...base,
      rules,
      busyRanges: [{ start_at: "2026-07-13T09:30:00Z", end_at: "2026-07-13T10:30:00Z" }],
    });
    // 09:00–10:00 overlaps, 09:30–10:30 overlaps, 10:00–11:00 overlaps.
    expect(slots).toEqual([]);
  });

  it("keeps slots exactly adjacent to a booking (touching is not overlapping)", () => {
    const slots = computeAvailableSlots({
      ...base,
      rules,
      busyRanges: [{ start_at: "2026-07-13T10:00:00Z", end_at: "2026-07-13T11:00:00Z" }],
    });
    // Only 09:00–10:00 survives: it ends exactly when the booking starts.
    expect(slots.map(iso)).toEqual(["2026-07-13T09:00:00.000Z"]);
  });
});

describe("exceptions", () => {
  const rules = [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }];

  it("a full-day unavailable exception removes the whole day", () => {
    const slots = computeAvailableSlots({
      ...base,
      rules,
      exceptions: [{ date: MONDAY, start_time: null, end_time: null, is_available: false }],
    });
    expect(slots).toEqual([]);
  });

  it("a partial unavailable exception splits the window", () => {
    const slots = computeAvailableSlots({
      ...base,
      durationMinutes: 30,
      rules: [{ day_of_week: 1, start_time: "09:00", end_time: "12:00" }],
      exceptions: [{ date: MONDAY, start_time: "10:00", end_time: "10:30", is_available: false }],
    });
    // 09:00–10:00 and 10:30–12:00 remain; 30-min starts:
    expect(slots.map(iso)).toEqual([
      "2026-07-13T09:00:00.000Z",
      "2026-07-13T09:30:00.000Z",
      "2026-07-13T10:30:00.000Z",
      "2026-07-13T11:00:00.000Z",
      "2026-07-13T11:30:00.000Z",
    ]);
  });

  it("an available exception adds a window on a day with no rule", () => {
    const slots = computeAvailableSlots({
      ...base,
      rules: [],
      exceptions: [{ date: MONDAY, start_time: "14:00", end_time: "15:00", is_available: true }],
    });
    expect(slots.map(iso)).toEqual(["2026-07-13T14:00:00.000Z"]);
  });
});

describe("past-slot filtering", () => {
  it("excludes slots at or before `now`", () => {
    const slots = computeAvailableSlots({
      ...base,
      rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }],
      now: new Date("2026-07-13T09:30:00Z"),
    });
    // 09:00 is past; 09:30 equals now (excluded); 10:00 remains.
    expect(slots.map(iso)).toEqual(["2026-07-13T10:00:00.000Z"]);
  });
});

describe("timezone + DST correctness", () => {
  it("renders a tutor's wall-clock rule at the correct UTC instant per zone", () => {
    const slots = computeAvailableSlots({
      ...base,
      timeZone: "Asia/Tokyo",
      rules: [{ day_of_week: 1, start_time: "09:00", end_time: "10:00" }],
    });
    // 09:00 Tokyo = 00:00Z.
    expect(slots.map(iso)).toEqual(["2026-07-13T00:00:00.000Z"]);
  });

  it("shifts the UTC instant across a spring-forward boundary (New York, Mar 2026)", () => {
    const slots = computeAvailableSlots({
      ...base,
      timeZone: "America/New_York",
      startDate: "2026-03-07", // Saturday before the Mar 8 transition
      days: 2,
      now: new Date("2026-03-01T00:00:00Z"),
      rules: [
        { day_of_week: 6, start_time: "09:00", end_time: "10:00" }, // Sat (EST)
        { day_of_week: 0, start_time: "09:00", end_time: "10:00" }, // Sun (EDT)
      ],
    });
    // Same 09:00 wall clock; UTC instant moves 14:00Z -> 13:00Z overnight.
    expect(slots.map(iso)).toEqual(["2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z"]);
  });

  it("slot duration stays 60 real minutes even on the transition day", () => {
    const [slot] = computeAvailableSlots({
      ...base,
      timeZone: "America/New_York",
      startDate: "2026-03-08",
      days: 1,
      now: new Date("2026-03-01T00:00:00Z"),
      rules: [{ day_of_week: 0, start_time: "09:00", end_time: "10:00" }],
    });
    expect(slot.endAt.getTime() - slot.startAt.getTime()).toBe(60 * 60_000);
  });
});
