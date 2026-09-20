import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "@/lib/observability/logger";

/**
 * MSG-5 — what an operator actually gets to read.
 *
 * PostgREST errors are plain objects, not Errors. `String(err)` on one is
 * "[object Object]", so every database failure in this codebase — the path
 * deliberately made opaque to users, on the grounds that operators can see the
 * real thing — logged nothing an operator could act on either.
 */

function captureLine(fn: () => void): Record<string, unknown> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  fn();
  const line = spy.mock.calls.at(-1)?.[0] as string;
  return JSON.parse(line) as Record<string, unknown>;
}

afterEach(() => vi.restoreAllMocks());

describe("logging a database error", () => {
  it("keeps a PostgREST error's message, code, details and hint", async () => {
    // The exact shape supabase-js hands back on a failed query.
    const postgrestError = {
      message: 'new row violates row-level security policy for table "reviews"',
      code: "42501",
      details: null,
      hint: "Check the WITH CHECK expression",
    };

    const line = captureLine(() => logger.error("failed to create review", postgrestError));

    expect(line.errorMessage).toContain("row-level security");
    expect(line.errorCode).toBe("42501");
    expect(line.errorHint).toBe("Check the WITH CHECK expression");
  });

  it("never logs [object Object]", async () => {
    const line = captureLine(() => logger.error("something failed", { message: "oh no" }));

    expect(JSON.stringify(line)).not.toContain("[object Object]");
  });

  it("still describes a thrown Error in full", async () => {
    const line = captureLine(() => logger.error("boom", new TypeError("not a function")));

    expect(line.errorName).toBe("TypeError");
    expect(line.errorMessage).toBe("not a function");
    expect(line.stack).toBeTruthy();
  });

  it("handles a value with no message at all", async () => {
    // A thrown string, or a rejected promise carrying a number.
    const line = captureLine(() => logger.error("odd", "just a string"));

    expect(line.errorMessage).toBe("just a string");
  });

  it("does not throw on a circular object", async () => {
    // A logger that throws while reporting a failure loses both.
    const circular: Record<string, unknown> = { message: "cycle" };
    circular.self = circular;

    expect(() => captureLine(() => logger.error("circular", circular))).not.toThrow();
  });
});
