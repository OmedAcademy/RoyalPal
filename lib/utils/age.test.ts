import { describe, it, expect } from "vitest";
import { ageOn, meetsMinimumAge, MINIMUM_AGE_YEARS } from "@/lib/utils/age";

describe("ageOn", () => {
  it("counts whole years", () => {
    expect(ageOn("1990-06-15", new Date("2026-06-15T00:00:00Z"))).toBe(36);
    expect(ageOn("1990-06-15", new Date("2026-06-14T23:59:59Z"))).toBe(35);
    expect(ageOn("1990-06-15", new Date("2026-06-16T00:00:00Z"))).toBe(36);
  });

  it("is right on the day before a birthday, which is where interval maths fails", () => {
    // 18 years minus one day. Dividing the elapsed ms by 365.25 rounds this
    // up to 18 and lets a 17-year-old through.
    expect(ageOn("2008-09-20", new Date("2026-09-19T12:00:00Z"))).toBe(17);
    expect(ageOn("2008-09-19", new Date("2026-09-19T12:00:00Z"))).toBe(18);
  });

  it("handles a 29 February birth date in a non-leap year", () => {
    // Born 2004-02-29; on 2026-02-28 they have not yet had a birthday.
    expect(ageOn("2004-02-29", new Date("2026-02-28T00:00:00Z"))).toBe(21);
    expect(ageOn("2004-02-29", new Date("2026-03-01T00:00:00Z"))).toBe(22);
  });

  it("reads both dates in UTC, so the server's region cannot change an age", () => {
    // 23:30Z on the day before a birthday is already the birthday in Tokyo.
    // The answer must not depend on where this ran.
    const instant = new Date("2026-06-14T23:30:00Z");
    expect(ageOn("1990-06-15", instant)).toBe(35);
  });

  it("returns NaN for an unparseable date rather than a plausible number", () => {
    expect(Number.isNaN(ageOn("not-a-date"))).toBe(true);
  });
});

describe("meetsMinimumAge", () => {
  const on = new Date("2026-09-19T12:00:00Z");

  it("admits exactly the minimum age and above", () => {
    const eighteenToday = `${2026 - MINIMUM_AGE_YEARS}-09-19`;
    expect(meetsMinimumAge(eighteenToday, on)).toBe(true);
    expect(meetsMinimumAge(`${2026 - MINIMUM_AGE_YEARS - 5}-01-01`, on)).toBe(true);
  });

  it("refuses one day short", () => {
    expect(meetsMinimumAge(`${2026 - MINIMUM_AGE_YEARS}-09-20`, on)).toBe(false);
  });

  it("refuses a malformed date instead of failing open", () => {
    expect(meetsMinimumAge("", on)).toBe(false);
    expect(meetsMinimumAge("2008-13-45", on)).toBe(false);
  });
});
