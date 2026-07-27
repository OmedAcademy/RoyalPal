import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Shared-Stripe-account contract.
 *
 * RoyalPal runs inside Lingora's existing Stripe account, so metadata is the
 * only boundary between the two products. These tests pin that contract:
 * every required tag is written, and it is written to the PaymentIntent as
 * well as the Session (Stripe does not copy Session metadata onto the
 * PaymentIntent, and reconciliation/reporting reads the PaymentIntent).
 */

const create = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({ checkout: { sessions: { create } } }),
}));

const { createBookingCheckoutSession } = await import("@/lib/stripe/checkout");
const { ROYALPAL_PAYMENT_SEARCH_QUERY } = await import("@/lib/stripe/app-metadata");

const BOOKING = "b-1";
const STUDENT = "s-1";
const TUTOR = "t-1";

const params = {
  bookingId: BOOKING,
  tutorId: TUTOR,
  studentId: STUDENT,
  subjectId: 7,
  lessonType: "standard" as const,
  durationMinutes: 60,
  priceCents: 5000,
  currency: "usd",
  subjectName: "English",
  tutorName: "Ada",
};

const args = () => create.mock.calls[0][0];

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ id: "cs_1", url: "https://checkout.test/x" });
  process.env.NEXT_PUBLIC_APP_URL = "https://royalpal.test";
});

afterEach(() => {
  delete process.env.STRIPE_ROYALPAL_PRODUCT_ID;
});

describe("checkout session metadata", () => {
  it("tags the Session with app, platform, environment and the booking parties", async () => {
    await createBookingCheckoutSession(params);

    expect(args().metadata).toMatchObject({
      app: "royalpal",
      platform: "royalpal",
      booking_id: BOOKING,
      student_id: STUDENT,
      tutor_id: TUTOR,
    });
    expect(args().metadata.environment).toBeTruthy();
  });

  it("copies the same tags onto the PaymentIntent (reporting reads the PI)", async () => {
    await createBookingCheckoutSession(params);

    expect(args().payment_intent_data.metadata).toEqual(args().metadata);
    expect(args().payment_intent_data.metadata.app).toBe("royalpal");
  });

  it("exposes a search query that isolates RoyalPal revenue in the shared account", () => {
    expect(ROYALPAL_PAYMENT_SEARCH_QUERY).toBe("metadata['app']:'royalpal'");
  });
});

describe("product handling in the shared account", () => {
  it("attaches lessons to the configured RoyalPal Product when one is set", async () => {
    process.env.STRIPE_ROYALPAL_PRODUCT_ID = "prod_royalpal";

    await createBookingCheckoutSession(params);
    const price = args().line_items[0].price_data;

    expect(price.product).toBe("prod_royalpal");
    expect(price.product_data).toBeUndefined();
    // Amount stays dynamic — no per-tutor Price objects are created.
    expect(price.unit_amount).toBe(5000);
  });

  it("falls back to an ad-hoc Product that is still tagged and name-prefixed", async () => {
    await createBookingCheckoutSession(params);
    const price = args().line_items[0].price_data;

    expect(price.product).toBeUndefined();
    expect(price.product_data.name).toMatch(/^RoyalPal — /);
    expect(price.product_data.metadata).toMatchObject({
      app: "royalpal",
      platform: "royalpal",
    });
  });

  it("prices from the amount passed in, never a stored Price id", async () => {
    await createBookingCheckoutSession({ ...params, priceCents: 1234, currency: "eur" });
    const price = args().line_items[0].price_data;

    expect(price.unit_amount).toBe(1234);
    expect(price.currency).toBe("eur");
    expect(args().line_items[0].price).toBeUndefined();
  });
});
