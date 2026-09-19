import { describe, it, expect, afterEach, vi } from "vitest";
import { greeting } from "@/lib/utils/greeting";

/**
 * The hour is read out of Intl rather than from the Date, so it inherits the
 * same h23/h24 trap as utcToZonedParts: under a locale/ICU pair that prefers
 * h24, midnight parses as 24, and `24 < 12` is false — so someone opening the
 * app at 00:30 was told "Good evening". The boundary cases below are the ones
 * that actually distinguish the two cycles.
 */
describe("greeting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (utcIso: string, timezone: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(utcIso));
    return greeting(timezone);
  };

  it("greets the small hours as morning, not evening", () => {
    // 15:00Z = 00:00 next day in Tokyo — hour 0 under h23, hour 24 under h24.
    expect(at("2026-07-14T15:00:00Z", "Asia/Tokyo")).toBe("Good morning");
    expect(at("2026-07-14T15:30:00Z", "Asia/Tokyo")).toBe("Good morning");
    expect(at("2026-07-15T00:00:00Z", "UTC")).toBe("Good morning");
  });

  it("covers each band in the caller's zone", () => {
    expect(at("2026-07-15T02:00:00Z", "Asia/Tokyo")).toBe("Good morning"); // 11:00
    expect(at("2026-07-15T03:00:00Z", "Asia/Tokyo")).toBe("Good afternoon"); // 12:00
    expect(at("2026-07-15T08:59:00Z", "Asia/Tokyo")).toBe("Good afternoon"); // 17:59
    expect(at("2026-07-15T09:00:00Z", "Asia/Tokyo")).toBe("Good evening"); // 18:00
    expect(at("2026-07-15T14:59:00Z", "Asia/Tokyo")).toBe("Good evening"); // 23:59
  });

  it("reads the zone it is given, not the host zone", () => {
    // One instant, two zones, two different greetings.
    expect(at("2026-07-15T09:00:00Z", "Asia/Tokyo")).toBe("Good evening"); // 18:00
    expect(at("2026-07-15T09:00:00Z", "America/New_York")).toBe("Good morning"); // 05:00
  });
});
