import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Destination-charge refund contract: reverse_transfer/refund_application_fee
 * must be set when — and ONLY when — the original PaymentIntent actually had
 * an associated Connect transfer. Passing them unconditionally would make
 * Stripe reject refunds for lessons paid before their tutor connected an
 * account (a plain platform charge has no transfer to reverse).
 */

const retrieve = vi.fn();
const create = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    paymentIntents: { retrieve },
    refunds: { create },
  }),
}));

const { refundBookingPayment } = await import("@/lib/stripe/refunds");

beforeEach(() => {
  retrieve.mockReset();
  create.mockReset();
  create.mockResolvedValue({ id: "re_1" });
});

describe("refundBookingPayment — destination charges", () => {
  it("reverses the transfer and the application fee when the charge had one", async () => {
    retrieve.mockResolvedValue({
      id: "pi_1",
      transfer_data: { destination: "acct_tutor_1" },
    });

    await refundBookingPayment({ paymentIntentId: "pi_1" });

    const args = create.mock.calls[0][0];
    expect(args.payment_intent).toBe("pi_1");
    expect(args.reverse_transfer).toBe(true);
    expect(args.refund_application_fee).toBe(true);
  });

  it("omits reverse_transfer and refund_application_fee for a plain platform charge", async () => {
    retrieve.mockResolvedValue({ id: "pi_2", transfer_data: null });

    await refundBookingPayment({ paymentIntentId: "pi_2" });

    const args = create.mock.calls[0][0];
    expect(args.reverse_transfer).toBeUndefined();
    expect(args.refund_application_fee).toBeUndefined();
  });

  it("tags the refund with RoyalPal ownership metadata", async () => {
    retrieve.mockResolvedValue({ id: "pi_1", transfer_data: null });

    await refundBookingPayment({ paymentIntentId: "pi_1" });

    expect(create.mock.calls[0][0].metadata).toMatchObject({
      app: "royalpal",
      platform: "royalpal",
    });
  });

  it("determines transfer presence from Stripe's live PaymentIntent, not an assumption", async () => {
    retrieve.mockResolvedValue({ id: "pi_3", transfer_data: null });

    await refundBookingPayment({ paymentIntentId: "pi_3" });

    expect(retrieve).toHaveBeenCalledWith("pi_3");
  });

  it("returns the created refund", async () => {
    retrieve.mockResolvedValue({ id: "pi_1", transfer_data: null });
    create.mockResolvedValue({ id: "re_specific" });

    const refund = await refundBookingPayment({ paymentIntentId: "pi_1" });

    expect(refund.id).toBe("re_specific");
  });
});
