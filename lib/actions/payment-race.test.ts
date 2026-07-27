import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * PROOF: payment-ledger corruption via a check-then-act race in
 * retryBookingPayment.
 *
 * retryBookingPayment reads booking.status ('pending_payment') and only then
 * calls Stripe to open a new Checkout Session — a network round trip of
 * hundreds of milliseconds. startCheckout afterwards upserts the payments row
 * with `status: "requires_payment", paid_at: null` UNCONDITIONALLY.
 *
 * If the webhook for the *previous* session lands inside that window (very
 * reachable: the student pays in one tab, returns to a stale tab and clicks
 * "Complete payment"), the upsert overwrites a `succeeded` payment row.
 *
 * The interleaving is reproduced deterministically by having the mocked
 * Stripe call run the webhook while it is "in flight".
 */

const TUTOR = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const BOOKING = "44444444-4444-4444-8444-444444444444";

let fake: ReturnType<typeof createFakeSupabase>;
const createCheckout = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));
vi.mock("@/lib/notifications/service", () => ({
  NotificationService: { emit: vi.fn(), emitMany: vi.fn() },
}));
vi.mock("@/lib/stripe/checkout", () => ({
  createBookingCheckoutSession: (...a: unknown[]) => createCheckout(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const { retryBookingPayment } = await import("@/lib/actions/booking");
const { handleCheckoutSessionCompleted } = await import("@/lib/stripe/webhook-handlers");

const paidSession = () =>
  ({
    id: "cs_1",
    // Tagged as RoyalPal: the webhook ignores foreign events on the
    // Stripe account shared with Lingora.
    metadata: { booking_id: BOOKING, app: "royalpal" },
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 5000,
    currency: "usd",
  }) as never;

beforeEach(() => {
  fake = createFakeSupabase(
    {
      bookings: [
        {
          id: BOOKING,
          student_id: STUDENT,
          tutor_id: TUTOR,
          status: "pending_payment",
          subject_id: 1,
          lesson_duration_minutes: 60,
          price_cents: 5000,
          currency: "usd",
        },
      ],
      payments: [
        {
          id: "p1",
          booking_id: BOOKING,
          checkout_session_id: "cs_1",
          stripe_payment_intent_id: null,
          status: "requires_payment",
          amount_cents: 5000,
          currency: "usd",
          paid_at: null,
        },
      ],
      tutor_profiles: [{ id: TUTOR, verification_status: "approved", currency: "usd" }],
      subjects: [{ id: 1, name: "English" }],
      profiles: [
        { id: TUTOR, full_name: "Tutor" },
        { id: STUDENT, full_name: "Student", status: "active" },
      ],
    },
    { id: STUDENT },
  );
  createCheckout.mockReset();
});

describe("retryBookingPayment ⟂ webhook race", () => {
  /** Runs a retry during which the previous session's webhook settles. */
  async function retryWithWebhookMidFlight() {
    createCheckout.mockImplementation(async () => {
      await handleCheckoutSessionCompleted(paidSession());
      return { id: "cs_2", url: "https://checkout.test/2", payment_intent: null };
    });

    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    // Would throw NEXT_REDIRECT if it (incorrectly) sent the user to pay again.
    return retryBookingPayment({}, fd).catch((e) => ({ redirected: true, err: e }));
  }

  it("never downgrades a succeeded payment row (ledger integrity)", async () => {
    await retryWithWebhookMidFlight();

    const payment = fake.db.payments[0];
    expect(fake.db.bookings[0].status).toBe("confirmed");
    expect(payment.status).toBe("succeeded");
    expect(payment.paid_at).not.toBeNull();
  });

  it("does not send the student to a second checkout for an already-paid lesson", async () => {
    const result = await retryWithWebhookMidFlight();

    // No redirect: the post-Stripe re-check caught the settled payment.
    expect(result).toMatchObject({
      message: "This booking is already paid — no further payment is needed.",
    });
  });

  it("still redirects normally when no webhook interferes", async () => {
    createCheckout.mockResolvedValue({
      id: "cs_2",
      url: "https://checkout.test/2",
      payment_intent: null,
    });

    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    const outcome = await retryBookingPayment({}, fd).catch((e) => (e as { url?: string }).url);

    expect(outcome).toBe("https://checkout.test/2");
    expect(fake.db.payments[0].checkout_session_id).toBe("cs_2");
    expect(fake.db.payments[0].status).toBe("requires_payment");
  });
});
