import { describe, it, expect } from "vitest";
import { safeRedirectPath } from "@/lib/utils/safe-redirect";

/**
 * Every case below is a real open-redirect payload shape. The value under
 * test always arrives from a query string, so "who controls it" is "whoever
 * wrote the link the victim clicked".
 */
describe("safeRedirectPath", () => {
  const FALLBACK = "/student/dashboard";

  it("keeps a same-origin absolute path", () => {
    expect(safeRedirectPath("/student/bookings", FALLBACK)).toBe("/student/bookings");
    expect(safeRedirectPath("/student/tutors/abc?x=1#f", FALLBACK)).toBe(
      "/student/tutors/abc?x=1#f",
    );
  });

  it("rejects absolute URLs to another origin", () => {
    for (const evil of [
      "https://evil.example/login",
      "http://evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      expect(safeRedirectPath(evil, FALLBACK), evil).toBe(FALLBACK);
    }
  });

  it("rejects protocol-relative URLs, which browsers resolve as a HOST", () => {
    // The classic: looks like a path, navigates to https://evil.example.
    expect(safeRedirectPath("//evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("//evil.example/login", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects backslashes, which some parsers normalise to a slash", () => {
    expect(safeRedirectPath("/\\evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("\\\\evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/path\\to", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects control characters (header splitting)", () => {
    expect(safeRedirectPath("/ok\nLocation: https://evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/ok\r\nSet-Cookie: a=b", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/ok\u0000", FALLBACK)).toBe(FALLBACK);
  });

  it("falls back for empty, missing, non-string and absurdly long values", () => {
    expect(safeRedirectPath(null, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("relative/path", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath(`/${"a".repeat(600)}`, FALLBACK)).toBe(FALLBACK);
  });
});
