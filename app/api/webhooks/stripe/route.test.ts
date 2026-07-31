import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Webhook endpoint boundary. Signature verification is the only thing
 * standing between this endpoint and an attacker who can POST arbitrary
 * JSON to mark any booking paid — so "unsigned/forged requests are rejected
 * before any handler runs" is the security property under test here.
 *
 * Replay protection is Stripe's `constructEvent` (it validates the
 * timestamp in the signature header against a tolerance window); we verify
 * that we *delegate* to it and reject whenever it throws, rather than
 * re-implementing crypto.
 */

const constructEvent = vi.fn();
const handleCheckoutSessionCompleted = vi.fn();
const handlePaymentIntentSucceeded = vi.fn();
const handlePaymentIntentFailed = vi.fn();
const handleCheckoutSessionExpired = vi.fn();
const handleAccountUpdated = vi.fn();
const handleChargeRefunded = vi.fn();
const handleTransferReversed = vi.fn();
const handleChargeDisputeCreated = vi.fn();
const shouldProcessEvent = vi.fn();
const markEventProcessed = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({ webhooks: { constructEvent } }),
}));

vi.mock("@/lib/stripe/webhook-handlers", () => ({
  handleCheckoutSessionCompleted: (...a: unknown[]) => handleCheckoutSessionCompleted(...a),
  handlePaymentIntentSucceeded: (...a: unknown[]) => handlePaymentIntentSucceeded(...a),
  handlePaymentIntentFailed: (...a: unknown[]) => handlePaymentIntentFailed(...a),
  handleCheckoutSessionExpired: (...a: unknown[]) => handleCheckoutSessionExpired(...a),
  handleAccountUpdated: (...a: unknown[]) => handleAccountUpdated(...a),
  handleChargeRefunded: (...a: unknown[]) => handleChargeRefunded(...a),
  handleTransferReversed: (...a: unknown[]) => handleTransferReversed(...a),
  handleChargeDisputeCreated: (...a: unknown[]) => handleChargeDisputeCreated(...a),
  shouldProcessEvent: (...a: unknown[]) => shouldProcessEvent(...a),
  markEventProcessed: (...a: unknown[]) => markEventProcessed(...a),
}));

// The route refuses to run without a configured secret (see the
// misconfiguration guard); set one for the tests that exercise verification.
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

// Default: every event is new (not a duplicate delivery). Individual tests
// override with mockResolvedValueOnce(false) to exercise the skip path.
// mockResolvedValue (unlike mockClear in beforeEach) survives clearAllMocks.
shouldProcessEvent.mockResolvedValue(true);
markEventProcessed.mockResolvedValue(undefined);

const { POST } = await import("@/app/api/webhooks/stripe/route");

function request(body: string, headers: Record<string, string> = {}): NextRequest {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signature enforcement", () => {
  it("rejects a request with no stripe-signature header", async () => {
    const res = await POST(request("{}"));

    expect(res.status).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(handleCheckoutSessionCompleted).not.toHaveBeenCalled();
  });

  it("rejects a forged/invalid signature and runs no handler", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    const res = await POST(
      request('{"type":"checkout.session.completed"}', { "stripe-signature": "t=1,v1=bogus" }),
    );

    expect(res.status).toBe(400);
    expect(handleCheckoutSessionCompleted).not.toHaveBeenCalled();
  });

  it("rejects a replayed event whose timestamp is outside Stripe's tolerance", async () => {
    // Stripe's constructEvent raises for stale timestamps; we must surface 400.
    constructEvent.mockImplementation(() => {
      throw new Error("Timestamp outside the tolerance zone");
    });

    const res = await POST(request("{}", { "stripe-signature": "t=1,v1=old" }));

    expect(res.status).toBe(400);
  });

  it("verifies the raw body, not a re-serialized object", async () => {
    const raw = '{"type":"checkout.session.completed","data":{"object":{}}}';
    constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: {} },
    });

    await POST(request(raw, { "stripe-signature": "sig" }));

    expect(constructEvent).toHaveBeenCalledWith(raw, "sig", "whsec_test");
  });

  it("returns 500 (not a misleading 400) when the webhook secret is unconfigured", async () => {
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const res = await POST(request("{}", { "stripe-signature": "sig" }));

      expect(res.status).toBe(500);
      expect(constructEvent).not.toHaveBeenCalled();
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = saved;
    }
  });
});

describe("event dispatch", () => {
  const signed = (type: string) => {
    constructEvent.mockReturnValue({ type, data: { object: { id: "obj_1" } } });
    return request("{}", { "stripe-signature": "sig" });
  };

  it("routes each known event type to its handler and acknowledges", async () => {
    const cases: [string, ReturnType<typeof vi.fn>][] = [
      ["checkout.session.completed", handleCheckoutSessionCompleted],
      ["checkout.session.expired", handleCheckoutSessionExpired],
      ["payment_intent.succeeded", handlePaymentIntentSucceeded],
      ["payment_intent.payment_failed", handlePaymentIntentFailed],
      ["account.updated", handleAccountUpdated],
      ["charge.refunded", handleChargeRefunded],
      ["charge.dispute.created", handleChargeDisputeCreated],
      ["transfer.reversed", handleTransferReversed],
    ];

    for (const [type, handler] of cases) {
      vi.clearAllMocks();
      shouldProcessEvent.mockResolvedValue(true);
      const res = await POST(signed(type));
      expect(res.status, type).toBe(200);
      expect(handler, type).toHaveBeenCalledTimes(1);
      expect(markEventProcessed, type).toHaveBeenCalledTimes(1);
    }
  });

  it("acknowledges unhandled event types without erroring (Stripe sends many)", async () => {
    const res = await POST(signed("customer.created"));

    expect(res.status).toBe(200);
    expect(handleCheckoutSessionCompleted).not.toHaveBeenCalled();
  });

  it("returns 500 when a handler throws, so Stripe retries delivery", async () => {
    handlePaymentIntentSucceeded.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(signed("payment_intent.succeeded"));

    expect(res.status).toBe(500);
  });

  it("does not mark the event processed when its handler throws (so a retry can reprocess)", async () => {
    handlePaymentIntentSucceeded.mockRejectedValueOnce(new Error("db down"));

    await POST(signed("payment_intent.succeeded"));

    expect(markEventProcessed).not.toHaveBeenCalled();
  });
});

describe("idempotency ledger", () => {
  const signed = (type: string) => {
    constructEvent.mockReturnValue({ type, data: { object: { id: "obj_1" } } });
    return request("{}", { "stripe-signature": "sig" });
  };

  it("skips dispatch entirely for an already-processed duplicate delivery", async () => {
    shouldProcessEvent.mockResolvedValueOnce(false);

    const res = await POST(signed("payment_intent.succeeded"));

    expect(res.status).toBe(200);
    expect(handlePaymentIntentSucceeded).not.toHaveBeenCalled();
    expect(markEventProcessed).not.toHaveBeenCalled();
  });

  it("marks the event processed only after its handler succeeds", async () => {
    await POST(signed("checkout.session.completed"));

    expect(markEventProcessed).toHaveBeenCalledTimes(1);
  });
});
