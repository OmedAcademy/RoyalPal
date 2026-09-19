import { describe, it, expect } from "vitest";
import { safeFields } from "@/lib/observability/alerts";

/**
 * An alerting channel is usually the least-protected surface an organisation
 * has — a Slack channel half the company can read. These tests pin that an
 * outage cannot turn into a disclosure through it.
 */
describe("safeFields", () => {
  it("drops credentials and personal data outright", () => {
    const result = safeFields({
      component: "stripe-webhook",
      email: "student@example.com",
      token: "eyJhbGciOi...",
      accessToken: "secret",
      refreshToken: "secret",
      authorization: "Bearer abc",
      password: "hunter2",
      apiKey: "sk_live_123",
      secret: "shh",
      key: "value",
    });

    expect(result).toEqual({ component: "stripe-webhook" });
  });

  it("drops the stack trace, which is where file paths and values leak", () => {
    const result = safeFields({ errorName: "Error", stack: "at /home/user/secret/path.ts:12" });
    expect(result).toEqual({ errorName: "Error" });
  });

  it("keeps the correlation ids that make an alert actionable", () => {
    const result = safeFields({
      bookingId: "44444444-4444-4444-8444-444444444444",
      stripeEventId: "evt_123",
      requestId: "req_abc",
      durationMs: 1200,
      ok: false,
    });

    expect(result).toEqual({
      bookingId: "44444444-4444-4444-8444-444444444444",
      stripeEventId: "evt_123",
      requestId: "req_abc",
      durationMs: 1200,
      ok: false,
    });
  });

  it("drops nested objects and arrays, where payloads hide", () => {
    const result = safeFields({
      component: "webhook",
      event: { id: "evt_1", data: { object: { email: "leak@example.com" } } },
      items: ["a", "b"],
    });

    expect(result).toEqual({ component: "webhook" });
  });

  it("truncates long strings so an alert cannot carry a document", () => {
    const result = safeFields({ errorMessage: "x".repeat(500) });
    expect((result.errorMessage as string).length).toBe(201); // 200 + ellipsis
    expect(result.errorMessage).toMatch(/…$/);
  });

  it("keeps null but not undefined, so an absent field stays absent", () => {
    const result = safeFields({ a: null, b: undefined });
    expect(result).toEqual({ a: null });
  });
});
