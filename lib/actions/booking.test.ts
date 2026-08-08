import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * Booking Server Actions — the revenue write path.
 *
 * Focus of these tests, in priority order:
 *   1. Authorization: a caller must not be able to book against a tutor who
 *      isn't approved, buy a subject a tutor doesn't teach, or act on another
 *      student's booking (IDOR).
 *   2. Money: the price must ALWAYS be derived server-side from the tutor's
 *      stored rate. The form never sends a price, and these tests pin that
 *      the persisted amount comes from the database row.
 *   3. Concurrency: when Postgres rejects an overlapping booking via the
 *      exclusion constraint (23P01), the user gets a correct, actionable
 *      message rather than a raw database error.
 *
 * Note: double-booking itself is enforced by the database constraint, which
 * cannot be exercised without a real Postgres. These tests verify the
 * application's *handling* of that rejection. ❌ The constraint's own
 * behaviour is not covered here.
 */

const TUTOR = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const BOOKING = "44444444-4444-4444-8444-444444444444";

let fake: ReturnType<typeof createFakeSupabase>;
const emit = vi.fn();
const createCheckout = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));
vi.mock("@/lib/notifications/service", () => ({
  NotificationService: { emit: (...a: unknown[]) => emit(...a) },
}));
// Mocked rather than stubbing STRIPE_SECRET_KEY: no key-shaped placeholder
// belongs in a committed file, and the behaviour under test is the action's
// branching, not env parsing. Flip `stripeConfigured` to exercise the
// unconfigured path.
let stripeConfigured = true;
vi.mock("@/lib/stripe/client", () => ({ isStripeConfigured: () => stripeConfigured }));

vi.mock("@/lib/stripe/checkout", () => ({
  createBookingCheckoutSession: (...a: unknown[]) => createCheckout(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const { createBooking, cancelBooking, retryBookingPayment } = await import("@/lib/actions/booking");

/** Runs an action that ends in redirect(), returning the redirect target. */
async function captureRedirect(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { url?: string }).url ?? null;
  }
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("tutorId", TUTOR);
  fd.set("subjectId", "1");
  fd.set("startAt", FUTURE);
  fd.set("durationMinutes", "60");
  fd.set("lessonType", "standard");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

function seed(
  opts: {
    verification?: string;
    trialPrice?: number | null;
    user?: string | null;
    chargesEnabled?: boolean;
    feeBps?: number | null;
  } = {},
) {
  fake = createFakeSupabase(
    {
      tutor_profiles: [
        {
          id: TUTOR,
          hourly_rate_cents: 5000,
          trial_price_cents: opts.trialPrice === undefined ? 2000 : opts.trialPrice,
          currency: "usd",
          verification_status: opts.verification ?? "approved",
          // Defaults to true so every pre-existing test (written before
          // Connect gating existed) keeps exercising standard bookings
          // without needing to know about Stripe Connect at all.
          stripe_charges_enabled: opts.chargesEnabled ?? true,
          platform_fee_bps: opts.feeBps ?? null,
        },
      ],
      tutor_subjects: [{ tutor_id: TUTOR, subject_id: 1 }],
      bookings: [],
      subjects: [{ id: 1, name: "English" }],
      profiles: [
        { id: TUTOR, full_name: "Tutor" },
        { id: STUDENT, full_name: "Student", status: "active" },
      ],
      payments: [],
    },
    opts.user === undefined ? { id: STUDENT } : opts.user ? { id: opts.user } : null,
  );
}

beforeEach(() => {
  stripeConfigured = true;
  seed();
  emit.mockClear();
  createCheckout.mockReset();
  createCheckout.mockResolvedValue({
    id: "cs_1",
    url: "https://checkout.test/x",
    payment_intent: null,
  });
});

describe("createBooking — authorization", () => {
  it("refuses when the caller is not signed in", async () => {
    seed({ user: null });
    const res = await createBooking({}, form());

    expect(res.error).toBe("You must be signed in");
    expect(fake.db.bookings).toHaveLength(0);
  });

  it("refuses a tutor who is not approved", async () => {
    seed({ verification: "pending" });
    const res = await createBooking({}, form());

    expect(res.error).toBe("This tutor is not available for booking");
    expect(fake.db.bookings).toHaveLength(0);
  });

  it("refuses a subject the tutor does not teach", async () => {
    const res = await createBooking({}, form({ subjectId: "999" }));

    expect(res.error).toBe("This tutor does not teach that subject");
    expect(fake.db.bookings).toHaveLength(0);
  });

  it("refuses a trial when the tutor offers none", async () => {
    seed({ trialPrice: null });
    const res = await createBooking({}, form({ lessonType: "trial", durationMinutes: "30" }));

    expect(res.error).toBe("This tutor does not offer trial lessons");
    expect(fake.db.bookings).toHaveLength(0);
  });
});

describe("createBooking — input validation", () => {
  it("rejects a malformed tutor id", async () => {
    const res = await createBooking({}, form({ tutorId: "not-a-uuid" }));
    expect(res.error).toBeTruthy();
    expect(fake.db.bookings).toHaveLength(0);
  });

  it("rejects a duration that is neither 30 nor 60", async () => {
    const res = await createBooking({}, form({ durationMinutes: "45" }));
    expect(res.error).toBeTruthy();
    expect(fake.db.bookings).toHaveLength(0);
  });

  it("rejects a lessonType/duration mismatch", async () => {
    const res = await createBooking({}, form({ lessonType: "trial", durationMinutes: "60" }));
    expect(res.error).toBe("Trial lessons are 30 minutes; standard lessons are 60 minutes");
    expect(fake.db.bookings).toHaveLength(0);
  });

  it("rejects a start time in the past", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const res = await createBooking({}, form({ startAt: past }));

    expect(res.error).toBe("Pick a time in the future");
    expect(fake.db.bookings).toHaveLength(0);
  });
});

describe("createBooking — server-derived pricing", () => {
  it("uses the tutor's stored hourly rate and the default 10% platform fee", async () => {
    await captureRedirect(() => createBooking({}, form()));

    const booking = fake.db.bookings[0];
    expect(booking.price_cents).toBe(5000);
    expect(booking.platform_fee_cents).toBe(500);
    expect(booking.currency).toBe("usd");
    expect(booking.status).toBeUndefined(); // DB default: pending_payment
  });

  it("honours a tutor's negotiated commission override", async () => {
    seed({ feeBps: 500 }); // 5%

    await captureRedirect(() => createBooking({}, form()));

    expect(fake.db.bookings[0].platform_fee_cents).toBe(250);
  });

  it("charges nothing to a zero-commission tutor", async () => {
    seed({ feeBps: 0 });

    await captureRedirect(() => createBooking({}, form()));

    expect(fake.db.bookings[0].platform_fee_cents).toBe(0);
  });

  it("uses the trial price for a trial lesson", async () => {
    await captureRedirect(() =>
      createBooking({}, form({ lessonType: "trial", durationMinutes: "30" })),
    );

    expect(fake.db.bookings[0].price_cents).toBe(2000);
    expect(fake.db.bookings[0].lesson_duration_minutes).toBe(30);
  });

  it("ignores any client-supplied price field", async () => {
    // A hostile client adds price fields; they must have no effect.
    await captureRedirect(() =>
      createBooking({}, form({ price_cents: "1", priceCents: "1", platform_fee_cents: "0" })),
    );

    expect(fake.db.bookings[0].price_cents).toBe(5000);
    expect(fake.db.bookings[0].platform_fee_cents).toBe(500);
  });

  it("records the student as the caller, not any client-supplied id", async () => {
    await captureRedirect(() => createBooking({}, form({ student_id: OTHER, studentId: OTHER })));

    expect(fake.db.bookings[0].student_id).toBe(STUDENT);
  });
});

describe("createBooking — concurrency and failure handling", () => {
  it("surfaces an exclusion-constraint violation as an actionable message", async () => {
    fake.control.insertError = { code: "23P01", message: "conflicting key value" };

    const res = await createBooking({}, form());

    expect(res.error).toBe("That time was just booked by someone else — pick another slot.");
  });

  it("redirects to Stripe Checkout on success", async () => {
    const url = await captureRedirect(() => createBooking({}, form()));
    expect(url).toBe("https://checkout.test/x");
  });

  it("releases the slot when checkout cannot be started", async () => {
    createCheckout.mockRejectedValue(new Error("stripe down"));

    const res = await createBooking({}, form());

    expect(res.error).toBe("We couldn't start checkout. Please try again.");
    expect(fake.db.bookings[0].status).toBe("cancelled");
    expect(fake.db.bookings[0].cancellation_reason).toBe("Payment setup failed");
  });
});

describe("createBooking — Connect destination-charge plumbing", () => {
  it("passes the server-derived platform fee and the tutor's connected account to Checkout", async () => {
    fake.db.tutor_profiles[0].stripe_account_id = "acct_tutor_1";

    await captureRedirect(() => createBooking({}, form()));

    const args = createCheckout.mock.calls[0][0];
    expect(args.platformFeeCents).toBe(500);
    expect(args.tutorStripeAccountId).toBe("acct_tutor_1");
  });

  it("passes null when the tutor hasn't connected a Stripe account yet", async () => {
    // Destination-charge routing is additive, not a booking gate: an
    // unconnected tutor can still be booked today, Checkout just falls
    // back to a plain platform charge until they onboard.
    await captureRedirect(() => createBooking({}, form()));

    const args = createCheckout.mock.calls[0][0];
    expect(args.tutorStripeAccountId).toBeNull();
  });
});

describe("createBooking — Connect payout gate (Milestone 2.6)", () => {
  it("refuses a standard booking when the tutor hasn't completed Connect onboarding", async () => {
    seed({ chargesEnabled: false });

    const res = await createBooking({}, form());

    expect(res.error).toBe(
      "This tutor is not yet accepting payments. Try booking a trial lesson instead, or check back soon.",
    );
    expect(fake.db.bookings).toHaveLength(0);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("still allows a trial booking when the tutor hasn't completed Connect onboarding", async () => {
    seed({ chargesEnabled: false });

    const url = await captureRedirect(() =>
      createBooking({}, form({ lessonType: "trial", durationMinutes: "30" })),
    );

    expect(url).toBe("https://checkout.test/x");
    expect(fake.db.bookings).toHaveLength(1);
  });

  it("allows a standard booking once the tutor is charges_enabled", async () => {
    seed({ chargesEnabled: true });

    const url = await captureRedirect(() => createBooking({}, form()));

    expect(url).toBe("https://checkout.test/x");
  });

  it("reads charges_enabled from the tutor's own row, never from client input", async () => {
    seed({ chargesEnabled: false });

    // A hostile client claims charges are enabled via an unexpected field;
    // it must have no effect since the gate never reads form input for this.
    const res = await createBooking({}, form({ stripe_charges_enabled: "true" }));

    expect(res.error).toContain("not yet accepting payments");
  });
});

describe("cancelBooking", () => {
  beforeEach(() => {
    fake.db.bookings.push({
      id: BOOKING,
      student_id: STUDENT,
      tutor_id: TUTOR,
      status: "confirmed",
    });
  });

  it("requires authentication", async () => {
    seed({ user: null });
    const fd = new FormData();
    fd.set("bookingId", BOOKING);

    expect((await cancelBooking({}, fd)).error).toBe("You must be signed in");
  });

  it("cancels and notifies the other participant (student cancels -> tutor notified)", async () => {
    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    fd.set("reason", "Sick");

    const res = await cancelBooking({}, fd);

    expect(res.message).toBe("Booking cancelled");
    expect(fake.db.bookings[0].status).toBe("cancelled");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ userId: TUTOR, type: "booking_cancelled" });
  });

  it("rejects a malformed booking id", async () => {
    const fd = new FormData();
    fd.set("bookingId", "nope");

    expect((await cancelBooking({}, fd)).error).toBeTruthy();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("retryBookingPayment — ownership (IDOR)", () => {
  it("refuses a booking that does not belong to the caller", async () => {
    // Booking owned by OTHER; caller is STUDENT. The query is scoped by
    // student_id, so it must not be found.
    fake.db.bookings.push({
      id: BOOKING,
      student_id: OTHER,
      tutor_id: TUTOR,
      status: "pending_payment",
      subject_id: 1,
      lesson_duration_minutes: 60,
      price_cents: 5000,
      currency: "usd",
    });
    const fd = new FormData();
    fd.set("bookingId", BOOKING);

    expect((await retryBookingPayment({}, fd)).error).toBe("Booking not found");
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("refuses a booking that is no longer awaiting payment", async () => {
    fake.db.bookings.push({
      id: BOOKING,
      student_id: STUDENT,
      tutor_id: TUTOR,
      status: "confirmed",
      subject_id: 1,
      lesson_duration_minutes: 60,
      price_cents: 5000,
      currency: "usd",
    });
    const fd = new FormData();
    fd.set("bookingId", BOOKING);

    expect((await retryBookingPayment({}, fd)).error).toBe(
      "This booking is no longer awaiting payment",
    );
    expect(createCheckout).not.toHaveBeenCalled();
  });
});

describe("retryBookingPayment — Connect payout gate (Milestone 2.6)", () => {
  it("refuses to retry a standard booking once the tutor's payouts are disabled", async () => {
    seed({ chargesEnabled: false });
    fake.db.bookings.push({
      id: BOOKING,
      student_id: STUDENT,
      tutor_id: TUTOR,
      status: "pending_payment",
      subject_id: 1,
      lesson_duration_minutes: 60,
      price_cents: 5000,
      platform_fee_cents: 750,
      currency: "usd",
    });
    const fd = new FormData();
    fd.set("bookingId", BOOKING);

    const res = await retryBookingPayment({}, fd);

    expect(res.error).toBe(
      "This tutor is not currently accepting payments. Please check back soon.",
    );
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("still allows retrying a trial booking when the tutor's payouts are disabled", async () => {
    seed({ chargesEnabled: false });
    fake.db.bookings.push({
      id: BOOKING,
      student_id: STUDENT,
      tutor_id: TUTOR,
      status: "pending_payment",
      subject_id: 1,
      lesson_duration_minutes: 30,
      price_cents: 2000,
      platform_fee_cents: 300,
      currency: "usd",
    });
    const fd = new FormData();
    fd.set("bookingId", BOOKING);

    const url = await captureRedirect(() => retryBookingPayment({}, fd));

    expect(url).toBe("https://checkout.test/x");
  });
});

describe("suspended accounts (authorization)", () => {
  it("cannot create a booking even with a valid session", async () => {
    // Middleware only guards /student|/tutor|/admin navigation; Server Actions
    // are separately addressable, so the action itself must refuse.
    fake.db.profiles.find((p) => p.id === STUDENT)!.status = "suspended";

    const res = await createBooking({}, form());

    expect(res.error).toBe("Your account is suspended. Please contact support.");
    expect(fake.db.bookings).toHaveLength(0);
  });

  it("cannot cancel a booking", async () => {
    fake.db.bookings.push({
      id: BOOKING,
      student_id: STUDENT,
      tutor_id: TUTOR,
      status: "confirmed",
    });
    fake.db.profiles.find((p) => p.id === STUDENT)!.status = "suspended";

    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    const res = await cancelBooking({}, fd);

    expect(res.error).toBe("Your account is suspended. Please contact support.");
    expect(fake.db.bookings[0].status).toBe("confirmed");
  });
});

describe("graceful degradation when Stripe is not configured", () => {
  it("refuses to create a booking, and creates NO row to clean up later", async () => {
    stripeConfigured = false;

    const res = await createBooking({}, form());

    expect(res.error).toBe("Booking is temporarily unavailable. Please try again later.");
    // The guard runs before the insert precisely so there is no orphan
    // pending_payment booking to cancel afterwards.
    expect(fake.db.bookings).toHaveLength(0);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("refuses to retry payment", async () => {
    stripeConfigured = false;
    const fd = new FormData();
    fd.set("bookingId", BOOKING);

    const res = await retryBookingPayment({}, fd);

    expect(res.error).toBe("Payment is temporarily unavailable. Please try again later.");
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("still allows cancelling — nothing about it touches Stripe", async () => {
    fake.db.bookings.push({
      id: BOOKING,
      student_id: STUDENT,
      tutor_id: TUTOR,
      status: "confirmed",
    });
    stripeConfigured = false;
    const fd = new FormData();
    fd.set("bookingId", BOOKING);

    const res = await cancelBooking({}, fd);

    expect(res.message).toBe("Booking cancelled");
  });
});
