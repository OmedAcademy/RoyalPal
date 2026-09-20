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
// The booking insert runs through the service-role client. By default it
// shares the session fake's rows so assertions on fake.db see the write; a
// test that must prove WHICH client inserted sets `adminFake` to its own store.
let adminFake: ReturnType<typeof createFakeSupabase> | null = null;
const createAdminClient = vi.fn(() => (adminFake ?? fake).client);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));
// Slot computation has its own tests (lib/utils/availability-slots.test.ts);
// here it is stubbed so each test decides which start times are open.
const getSlots = vi.fn();
vi.mock("@/lib/supabase/availability", () => ({
  getTutorAvailableSlots: (...a: unknown[]) => getSlots(...a),
}));
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
// Mocked so the test can assert WHAT was sent to Stripe and, more
// importantly, what was NOT written to our own payments row as a result.
const refundPayment = vi.fn();
vi.mock("@/lib/stripe/refunds", () => ({
  refundBookingPayment: (...a: unknown[]) => refundPayment(...a),
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
    tutorStatus?: "active" | "suspended";
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
        // `status` matters now: createBooking refuses a suspended tutor, and
        // the column is NOT NULL DEFAULT 'active' in the real schema, so a
        // fixture without it was modelling a row that cannot exist.
        {
          id: TUTOR,
          full_name: "Tutor",
          role: "tutor",
          timezone: "Europe/Dublin",
          status: opts.tutorStatus ?? "active",
        },
        { id: STUDENT, full_name: "Student", role: "student", status: "active" },
      ],
      payments: [],
    },
    opts.user === undefined ? { id: STUDENT } : opts.user ? { id: opts.user } : null,
  );
}

/** Makes exactly these start times the tutor's open slots. */
function openSlotsAt(...isoTimes: string[]) {
  getSlots.mockImplementation(async ({ durationMinutes }: { durationMinutes: number }) =>
    isoTimes.map((iso) => ({
      startAt: new Date(iso),
      endAt: new Date(Date.parse(iso) + durationMinutes * 60_000),
    })),
  );
}

beforeEach(() => {
  stripeConfigured = true;
  seed();
  adminFake = null;
  createAdminClient.mockClear();
  getSlots.mockReset();
  openSlotsAt(FUTURE);
  emit.mockClear();
  createCheckout.mockReset();
  createCheckout.mockResolvedValue({
    id: "cs_1",
    url: "https://checkout.test/x",
    payment_intent: null,
  });
  refundPayment.mockReset();
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

describe("createBooking — trust boundary (migration 0029)", () => {
  it("refuses a caller who is not a student", async () => {
    seed({ user: TUTOR });

    const res = await createBooking({}, form());

    expect(res.error).toBe("Only students can book lessons");
    expect(fake.db.bookings).toHaveLength(0);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("refuses a booking with a SUSPENDED tutor", async () => {
    // verification_status and account status are different things. Search
    // filtered on the first only, so suspending a tutor for misconduct left
    // them bookable and money would still move to them.
    seed({ tutorStatus: "suspended" });

    const res = await createBooking({}, form());

    expect(res.error).toBe("This tutor is not available for booking");
    expect(fake.db.bookings).toHaveLength(0);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("gives a suspended tutor the same answer as an unapproved one", async () => {
    // Whether a tutor is suspended is not a student's business.
    seed({ tutorStatus: "suspended" });
    const suspendedRes = await createBooking({}, form());
    seed({ verification: "pending" });
    const unapprovedRes = await createBooking({}, form());

    expect(suspendedRes.error).toBe(unapprovedRes.error);
  });

  it("refuses a start time that is not one of the tutor's open slots", async () => {
    // startAt is a hidden form field: one minute off a real slot is enough to
    // prove the server no longer takes it on trust.
    const offSlot = new Date(Date.parse(FUTURE) + 60_000).toISOString();

    const res = await createBooking({}, form({ startAt: offSlot }));

    expect(res.error).toBe("That time isn't one of this tutor's open slots. Please pick another.");
    expect(fake.db.bookings).toHaveLength(0);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("looks slots up for the requested tutor, in the tutor's timezone and lesson length", async () => {
    await captureRedirect(() =>
      createBooking({}, form({ lessonType: "trial", durationMinutes: "30" })),
    );

    expect(getSlots).toHaveBeenCalledWith({
      tutorId: TUTOR,
      timeZone: "Europe/Dublin",
      durationMinutes: 30,
    });
  });

  it("inserts the booking through the service role, never the caller's session", async () => {
    // The admin fake now needs the tutor's rows too: migration 0041 withholds
    // platform_fee_bps and stripe_account_id from `authenticated`, so the
    // commission lookup and the destination-charge lookup moved to the service
    // role alongside the insert. bookings/payments stay empty so the
    // assertions below still prove where the WRITE happened.
    adminFake = createFakeSupabase({
      tutor_profiles: [
        {
          id: TUTOR,
          hourly_rate_cents: 5000,
          trial_price_cents: 2000,
          currency: "usd",
          verification_status: "approved",
          stripe_charges_enabled: true,
          platform_fee_bps: null,
        },
      ],
      profiles: [{ id: TUTOR, full_name: "Tutor", role: "tutor", timezone: "Europe/Dublin" }],
      subjects: [{ id: 1, name: "English" }],
      bookings: [],
      payments: [],
    });

    await captureRedirect(() => createBooking({}, form()));

    expect(adminFake.db.bookings).toHaveLength(1);
    expect(adminFake.db.bookings[0]).toMatchObject({
      student_id: STUDENT,
      tutor_id: TUTOR,
      price_cents: 5000,
    });
    expect(fake.db.bookings).toHaveLength(0);
  });

  it("refuses a time entirely outside the tutor's availability", async () => {
    // The tutor's only open slot is a full day later.
    openSlotsAt(new Date(Date.parse(FUTURE) + 86_400_000).toISOString());

    const res = await createBooking({}, form());

    expect(res.error).toBe("That time isn't one of this tutor's open slots. Please pick another.");
    expect(fake.db.bookings).toHaveLength(0);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("refuses a time in the past even when it is listed as an open slot", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    openSlotsAt(past);

    const res = await createBooking({}, form({ startAt: past }));

    expect(res.error).toBe("Pick a time in the future");
    expect(fake.db.bookings).toHaveLength(0);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("turns a slot already held by a confirmed booking (23P01) into a readable message", async () => {
    // The slot list can be stale; the exclusion constraint is the real guard.
    fake.control.insertError = {
      code: "23P01",
      message: 'conflicting key value violates exclusion constraint "bookings_no_double_booking"',
    };

    const res = await createBooking({}, form());

    expect(res.error).toBe("That time was just booked by someone else — pick another slot.");
    expect(res.error).not.toContain("exclusion constraint");
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("never shows the raw database message when the tutor's rate changed mid-booking (42501)", async () => {
    fake.control.insertError = {
      code: "42501",
      message: "booking price does not match the tutor's current rate",
    };

    const res = await createBooking({}, form());

    expect(res.error).toBe(
      "This tutor's price changed while you were booking. Please refresh and try again.",
    );
    expect(res.error).not.toContain("does not match");
    expect(createCheckout).not.toHaveBeenCalled();
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
  /** Hours from now, as the ISO string a booking row would hold. */
  const startingIn = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

  function pushBooking(over: Record<string, unknown> = {}) {
    fake.db.bookings.push({
      id: BOOKING,
      student_id: STUDENT,
      tutor_id: TUTOR,
      status: "confirmed",
      // Both matter to the policy, so a fixture without them was testing the
      // NaN path rather than any rule anyone wrote.
      start_at: startingIn(72),
      price_cents: 5000,
      ...over,
    });
  }

  /** A succeeded payment, which is what makes a refund possible at all. */
  function pushSucceededPayment() {
    fake.db.payments.push({
      booking_id: BOOKING,
      stripe_payment_intent_id: "pi_123",
      status: "succeeded",
      amount_cents: 5000,
    });
  }

  beforeEach(() => {
    pushBooking();
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

    expect(res.message).toMatch(/cancelled/i);
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

  it("records which policy rule fired and what it owes", async () => {
    const fd = new FormData();
    fd.set("bookingId", BOOKING);

    await cancelBooking({}, fd);

    // 72 hours out, cancelled by the student: full refund owed.
    expect(fake.db.bookings[0]).toMatchObject({
      cancellation_policy: "student_outside_window_full_refund",
      refund_owed_cents: 5000,
      cancelled_by: STUDENT,
    });
    expect(fake.db.bookings[0].cancelled_at).toBeTruthy();
  });

  it("owes nothing when the student cancels inside the window", async () => {
    fake.db.bookings.length = 0;
    pushBooking({ start_at: startingIn(2) });

    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    const res = await cancelBooking({}, fd);

    expect(fake.db.bookings[0]).toMatchObject({
      cancellation_policy: "student_inside_window_no_refund",
      refund_owed_cents: 0,
    });
    // No refund owed, so nothing about money is promised.
    expect(res.message).toBe("Lesson cancelled.");
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("owes a full refund whenever the TUTOR cancels, however late", async () => {
    seed({ user: TUTOR });
    fake.db.bookings.length = 0;
    pushBooking({ start_at: startingIn(1) });

    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    await cancelBooking({}, fd);

    expect(fake.db.bookings[0]).toMatchObject({
      cancellation_policy: "tutor_cancelled_full_refund",
      refund_owed_cents: 5000,
    });
  });

  it("cannot be talked into the tutor's outcome by the form", async () => {
    // The student is the caller; cancelledBy is resolved from the booking, so
    // a hostile field cannot buy a refund the window would refuse.
    fake.db.bookings.length = 0;
    pushBooking({ start_at: startingIn(2) });

    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    fd.set("cancelledBy", "tutor");
    await cancelBooking({}, fd);

    expect(fake.db.bookings[0].refund_owed_cents).toBe(0);
  });

  it("asks Stripe for the refund, and records only that it ASKED", async () => {
    pushSucceededPayment();
    refundPayment.mockResolvedValue({ id: "re_123" });

    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    const res = await cancelBooking({}, fd);

    expect(refundPayment).toHaveBeenCalledWith({ paymentIntentId: "pi_123" });
    expect(fake.db.payments[0]).toMatchObject({
      stripe_refund_id: "re_123",
      refund_requested_by: STUDENT,
    });
    expect(fake.db.payments[0].refund_requested_at).toBeTruthy();
    // The one that matters: asking is not the same as it having happened, and
    // only Stripe's charge.refunded event may write this field.
    expect(fake.db.payments[0].status).toBe("succeeded");
    expect(res.message).toMatch(/on its way/i);
  });

  it("still cancels, and says a refund is outstanding, when Stripe is unavailable", async () => {
    pushSucceededPayment();
    refundPayment.mockRejectedValue(new Error("stripe down"));

    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    const res = await cancelBooking({}, fd);

    // The lesson is cancelled either way — a payment problem must not trap a
    // student in a lesson they cancelled.
    expect(fake.db.bookings[0].status).toBe("cancelled");
    // And the obligation is still recorded, so it is not lost.
    expect(fake.db.bookings[0].refund_owed_cents).toBe(5000);
    expect(res.message).toMatch(/team has been notified/i);
    expect(fake.db.payments[0].status).toBe("succeeded");
  });

  it("does not attempt a refund when no payment ever succeeded", async () => {
    fake.db.payments.push({
      booking_id: BOOKING,
      stripe_payment_intent_id: "pi_123",
      status: "failed",
      amount_cents: 5000,
    });

    const fd = new FormData();
    fd.set("bookingId", BOOKING);
    const res = await cancelBooking({}, fd);

    expect(refundPayment).not.toHaveBeenCalled();
    expect(res.message).toBe("Lesson cancelled.");
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

  // CONTRACT CHANGE: this test used to be called "nothing about it touches
  // Stripe", which stopped being true when cancellation gained a refund
  // policy. A cancellation that owes money now DOES reach for Stripe. The
  // thing worth pinning is not that it avoids Stripe, but that an
  // unconfigured Stripe never traps a student in a lesson they cancelled, and
  // never silently loses what they are owed.
  it("still cancels when Stripe is unconfigured, and does not lose the refund owed", async () => {
    fake.db.bookings.push({
      id: BOOKING,
      student_id: STUDENT,
      tutor_id: TUTOR,
      status: "confirmed",
      start_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
      price_cents: 5000,
    });
    fake.db.payments.push({
      booking_id: BOOKING,
      stripe_payment_intent_id: "pi_123",
      status: "succeeded",
      amount_cents: 5000,
    });
    stripeConfigured = false;
    const fd = new FormData();
    fd.set("bookingId", BOOKING);

    const res = await cancelBooking({}, fd);

    expect(fake.db.bookings[0].status).toBe("cancelled");
    // The obligation survives the outage, on the booking row, where the admin
    // refund queue can find it.
    expect(fake.db.bookings[0].refund_owed_cents).toBe(5000);
    expect(refundPayment).not.toHaveBeenCalled();
    expect(res.message).toMatch(/team has been notified/i);
  });
});
