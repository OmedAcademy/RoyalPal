import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import { createFakeSupabase, type Tables } from "@/tests/helpers/fake-supabase";

/**
 * Stripe webhook correctness.
 *
 * Stripe guarantees *at-least-once* delivery with no ordering guarantee, so
 * these handlers must be idempotent and order-independent. Money correctness
 * depends on it: a duplicate delivery must not double-record a payment, and
 * a late `payment_failed` for a superseded attempt must not downgrade a
 * booking the student already paid for.
 *
 * Assertions are on final row state (via an in-memory Supabase fake), not on
 * call counts, so they test behaviour rather than implementation.
 */

const BOOKING = "b1";
const STUDENT = "s1";
const TUTOR = "t1";

let fake: ReturnType<typeof createFakeSupabase>;
const emitMany = vi.fn();
const emit = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fake.client,
}));

vi.mock("@/lib/notifications/service", () => ({
  NotificationService: {
    emit: (...args: unknown[]) => emit(...args),
    emitMany: (...args: unknown[]) => emitMany(...args),
  },
}));

const {
  handleCheckoutSessionCompleted,
  handlePaymentIntentSucceeded,
  handlePaymentIntentFailed,
  handleCheckoutSessionExpired,
  handleAccountUpdated,
  handleChargeRefunded,
  shouldProcessEvent,
  markEventProcessed,
} = await import("@/lib/stripe/webhook-handlers");

function seed(overrides?: Partial<Tables>) {
  fake = createFakeSupabase({
    bookings: [{ id: BOOKING, status: "pending_payment", student_id: STUDENT, tutor_id: TUTOR }],
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
    ...overrides,
  });
}

const booking = () => fake.db.bookings[0];
const payments = () => fake.db.payments;
const payment = () => fake.db.payments[0];

const session = (over: Partial<Stripe.Checkout.Session> = {}) =>
  ({
    id: "cs_1",
    metadata: { booking_id: BOOKING, app: "royalpal" },
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 5000,
    currency: "usd",
    ...over,
  }) as unknown as Stripe.Checkout.Session;

const intent = (over: Partial<Stripe.PaymentIntent> = {}) =>
  ({
    id: "pi_1",
    metadata: { booking_id: BOOKING, app: "royalpal" },
    amount: 5000,
    currency: "usd",
    ...over,
  }) as unknown as Stripe.PaymentIntent;

beforeEach(() => {
  seed();
  emit.mockClear();
  emitMany.mockClear();
});

describe("checkout.session.completed", () => {
  it("records the payment and confirms the booking", async () => {
    await handleCheckoutSessionCompleted(session());

    expect(payment().status).toBe("succeeded");
    expect(payment().stripe_payment_intent_id).toBe("pi_1");
    expect(payment().paid_at).not.toBeNull();
    expect(booking().status).toBe("confirmed");
    expect(emitMany).toHaveBeenCalledTimes(1);
  });

  it("ignores a session that is not yet paid (delayed payment methods)", async () => {
    await handleCheckoutSessionCompleted(session({ payment_status: "unpaid" }));

    expect(payment().status).toBe("requires_payment");
    expect(booking().status).toBe("pending_payment");
  });

  it("ignores events with no booking_id metadata", async () => {
    await handleCheckoutSessionCompleted(session({ metadata: { app: "royalpal" } }));
    expect(booking().status).toBe("pending_payment");
  });

  it("ignores a paid session with no payment_intent", async () => {
    await handleCheckoutSessionCompleted(session({ payment_intent: null }));
    expect(booking().status).toBe("pending_payment");
  });
});

describe("payment_intent.succeeded", () => {
  it("records the payment and confirms the booking", async () => {
    await handlePaymentIntentSucceeded(intent());

    expect(payment().status).toBe("succeeded");
    expect(booking().status).toBe("confirmed");
  });

  it("does not clobber a checkout_session_id it does not carry", async () => {
    await handlePaymentIntentSucceeded(intent());
    expect(payment().checkout_session_id).toBe("cs_1");
  });
});

describe("idempotency — at-least-once delivery", () => {
  it("duplicate checkout.session.completed does not duplicate the payment row", async () => {
    await handleCheckoutSessionCompleted(session());
    await handleCheckoutSessionCompleted(session());

    expect(payments()).toHaveLength(1);
    expect(payment().status).toBe("succeeded");
    expect(booking().status).toBe("confirmed");
  });

  it("duplicate delivery notifies only once", async () => {
    await handleCheckoutSessionCompleted(session());
    await handleCheckoutSessionCompleted(session());

    expect(emitMany).toHaveBeenCalledTimes(1);
  });

  it("both event types for one payment produce a single succeeded row", async () => {
    await handleCheckoutSessionCompleted(session());
    await handlePaymentIntentSucceeded(intent());

    expect(payments()).toHaveLength(1);
    expect(payment().status).toBe("succeeded");
    expect(emitMany).toHaveBeenCalledTimes(1);
  });
});

describe("out-of-order delivery", () => {
  it("payment_intent.succeeded arriving before checkout.session.completed still settles correctly", async () => {
    await handlePaymentIntentSucceeded(intent());
    await handleCheckoutSessionCompleted(session());

    expect(payments()).toHaveLength(1);
    expect(payment().status).toBe("succeeded");
    expect(booking().status).toBe("confirmed");
    expect(emitMany).toHaveBeenCalledTimes(1);
  });

  it("a late payment_failed cannot downgrade an already-succeeded payment", async () => {
    await handlePaymentIntentSucceeded(intent());
    await handlePaymentIntentFailed(intent());

    expect(payment().status).toBe("succeeded");
    expect(booking().status).toBe("confirmed");
  });

  it("a late checkout.session.expired cannot cancel a confirmed booking", async () => {
    await handleCheckoutSessionCompleted(session());
    await handleCheckoutSessionExpired(session());

    expect(booking().status).toBe("confirmed");
    expect(payment().status).toBe("succeeded");
  });
});

describe("payment_intent.payment_failed", () => {
  it("marks the current attempt failed and leaves the booking pending", async () => {
    // Payment row already points at this attempt.
    payment().stripe_payment_intent_id = "pi_1";

    await handlePaymentIntentFailed(intent());

    expect(payment().status).toBe("failed");
    expect(booking().status).toBe("pending_payment");
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores a failure for a superseded attempt (student retried with a new intent)", async () => {
    payment().stripe_payment_intent_id = "pi_2"; // live attempt is pi_2

    await handlePaymentIntentFailed(intent({ id: "pi_1" })); // stale pi_1 fails

    expect(payment().status).toBe("requires_payment");
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("checkout.session.expired", () => {
  it("expires the payment and releases the pending booking", async () => {
    await handleCheckoutSessionExpired(session());

    expect(payment().status).toBe("expired");
    expect(booking().status).toBe("cancelled");
    expect(booking().cancellation_reason).toBe("Payment session expired");
  });

  it("ignores an expiry for a superseded session", async () => {
    payment().checkout_session_id = "cs_2"; // live attempt is cs_2

    await handleCheckoutSessionExpired(session({ id: "cs_1" }));

    expect(payment().status).toBe("requires_payment");
    expect(booking().status).toBe("pending_payment");
  });
});

describe("shared Stripe account isolation (Lingora)", () => {
  // The account is shared: Stripe delivers every subscribed event type to
  // every endpoint on it, so Lingora's payment events arrive here too.
  const foreign = { booking_id: BOOKING, app: "lingora" };

  it("ignores another app's checkout.session.completed even with a booking_id", async () => {
    await handleCheckoutSessionCompleted(session({ metadata: foreign }));

    expect(payment().status).toBe("requires_payment");
    expect(booking().status).toBe("pending_payment");
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("ignores another app's payment_intent.succeeded", async () => {
    await handlePaymentIntentSucceeded(intent({ metadata: foreign }));

    expect(payment().status).toBe("requires_payment");
    expect(booking().status).toBe("pending_payment");
  });

  it("ignores another app's payment_intent.payment_failed", async () => {
    payment().stripe_payment_intent_id = "pi_1";

    await handlePaymentIntentFailed(intent({ metadata: foreign }));

    expect(payment().status).toBe("requires_payment");
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores another app's checkout.session.expired (does not free our slot)", async () => {
    await handleCheckoutSessionExpired(session({ metadata: foreign }));

    expect(booking().status).toBe("pending_payment");
    expect(payment().status).toBe("requires_payment");
  });

  it("fails closed on untagged events (unknown third app on the account)", async () => {
    await handleCheckoutSessionCompleted(session({ metadata: { booking_id: BOOKING } }));

    expect(booking().status).toBe("pending_payment");
  });
});

const ACCOUNT = "acct_1";

const account = (over: Partial<Stripe.Account> = {}) =>
  ({
    id: ACCOUNT,
    charges_enabled: true,
    metadata: { app: "royalpal", tutor_id: TUTOR },
    ...over,
  }) as unknown as Stripe.Account;

describe("account.updated", () => {
  it("syncs stripe_charges_enabled to true when Stripe verifies the account", async () => {
    seed({
      tutor_profiles: [{ id: TUTOR, stripe_account_id: ACCOUNT, stripe_charges_enabled: false }],
    });

    await handleAccountUpdated(account({ charges_enabled: true }));

    expect(fake.db.tutor_profiles[0].stripe_charges_enabled).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("syncs back to false if Stripe later restricts the account", async () => {
    seed({
      tutor_profiles: [{ id: TUTOR, stripe_account_id: ACCOUNT, stripe_charges_enabled: true }],
    });

    await handleAccountUpdated(account({ charges_enabled: false }));

    expect(fake.db.tutor_profiles[0].stripe_charges_enabled).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it("is a no-op when the value hasn't actually changed (avoids notification spam)", async () => {
    seed({
      tutor_profiles: [{ id: TUTOR, stripe_account_id: ACCOUNT, stripe_charges_enabled: true }],
    });

    await handleAccountUpdated(account({ charges_enabled: true }));

    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores an account with no matching tutor row", async () => {
    seed({ tutor_profiles: [] });

    await expect(handleAccountUpdated(account())).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores another app's account.updated (shared Stripe account)", async () => {
    seed({
      tutor_profiles: [{ id: TUTOR, stripe_account_id: ACCOUNT, stripe_charges_enabled: false }],
    });

    await handleAccountUpdated(account({ metadata: { app: "lingora" } }));

    expect(fake.db.tutor_profiles[0].stripe_charges_enabled).toBe(false);
  });

  it("fails closed on an untagged account.updated", async () => {
    seed({
      tutor_profiles: [{ id: TUTOR, stripe_account_id: ACCOUNT, stripe_charges_enabled: false }],
    });

    await handleAccountUpdated(account({ metadata: {} }));

    expect(fake.db.tutor_profiles[0].stripe_charges_enabled).toBe(false);
  });
});

describe("stripe_events idempotency ledger", () => {
  const evt = (id = "evt_1", type = "payment_intent.succeeded") =>
    ({ id, type, data: { object: {} } }) as unknown as Stripe.Event;

  it("records a new event and returns true (process it)", async () => {
    seed({ stripe_events: [] });

    const proceed = await shouldProcessEvent(evt());

    expect(proceed).toBe(true);
    expect(fake.db.stripe_events).toHaveLength(1);
    // Not marked processed yet — the fake omits an unset key entirely
    // rather than storing Postgres's NULL, so check falsy rather than null.
    expect(fake.db.stripe_events[0].processed_at).toBeFalsy();
  });

  it("returns false for an event already fully processed (true duplicate)", async () => {
    seed({
      stripe_events: [
        {
          id: "evt_1",
          type: "payment_intent.succeeded",
          payload: {},
          processed_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const proceed = await shouldProcessEvent(evt());

    expect(proceed).toBe(false);
  });

  it("returns true to reprocess an event that was recorded but never finished (prior crash)", async () => {
    seed({
      stripe_events: [
        { id: "evt_1", type: "payment_intent.succeeded", payload: {}, processed_at: null },
      ],
    });

    const proceed = await shouldProcessEvent(evt());

    expect(proceed).toBe(true);
    expect(fake.db.stripe_events).toHaveLength(1); // not inserted a second time
  });

  it("markEventProcessed sets processed_at", async () => {
    seed({
      stripe_events: [
        { id: "evt_1", type: "payment_intent.succeeded", payload: {}, processed_at: null },
      ],
    });

    await markEventProcessed("evt_1");

    expect(fake.db.stripe_events[0].processed_at).not.toBeNull();
  });
});

const charge = (over: Partial<Stripe.Charge> = {}) =>
  ({
    id: "ch_1",
    payment_intent: "pi_1",
    ...over,
  }) as unknown as Stripe.Charge;

describe("charge.refunded", () => {
  it("marks the payment and a confirmed booking refunded, and notifies both parties", async () => {
    seed({
      bookings: [{ id: BOOKING, status: "confirmed", student_id: STUDENT, tutor_id: TUTOR }],
      payments: [
        { id: "p1", booking_id: BOOKING, stripe_payment_intent_id: "pi_1", status: "succeeded" },
      ],
    });

    await handleChargeRefunded(charge());

    expect(payment().status).toBe("refunded");
    expect(booking().status).toBe("refunded");
    expect(emitMany).toHaveBeenCalledTimes(1);
    const notified = (emitMany.mock.calls[0][0] as Array<{ userId: string }>).map(
      (n) => n.userId,
    );
    expect(notified).toEqual([STUDENT, TUTOR]);
  });

  it("also transitions a completed booking to refunded", async () => {
    seed({
      bookings: [{ id: BOOKING, status: "completed", student_id: STUDENT, tutor_id: TUTOR }],
      payments: [
        { id: "p1", booking_id: BOOKING, stripe_payment_intent_id: "pi_1", status: "succeeded" },
      ],
    });

    await handleChargeRefunded(charge());

    expect(booking().status).toBe("refunded");
  });

  it("marks the payment refunded even when the booking's own status can't follow (already cancelled)", async () => {
    seed({
      bookings: [{ id: BOOKING, status: "cancelled", student_id: STUDENT, tutor_id: TUTOR }],
      payments: [
        { id: "p1", booking_id: BOOKING, stripe_payment_intent_id: "pi_1", status: "succeeded" },
      ],
    });

    await handleChargeRefunded(charge());

    expect(payment().status).toBe("refunded");
    expect(booking().status).toBe("cancelled");
  });

  it("is idempotent — a duplicate delivery for an already-refunded payment does not notify again", async () => {
    seed({
      bookings: [{ id: BOOKING, status: "refunded", student_id: STUDENT, tutor_id: TUTOR }],
      payments: [
        { id: "p1", booking_id: BOOKING, stripe_payment_intent_id: "pi_1", status: "refunded" },
      ],
    });

    await handleChargeRefunded(charge());

    expect(emitMany).not.toHaveBeenCalled();
  });

  it("ignores a charge with no matching payment (foreign / shared-account charge)", async () => {
    seed({
      bookings: [{ id: BOOKING, status: "confirmed", student_id: STUDENT, tutor_id: TUTOR }],
      payments: [],
    });

    await handleChargeRefunded(charge({ payment_intent: "pi_unknown" }));

    expect(booking().status).toBe("confirmed");
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("ignores a charge with no payment_intent at all", async () => {
    seed({
      payments: [
        { id: "p1", booking_id: BOOKING, stripe_payment_intent_id: "pi_1", status: "succeeded" },
      ],
    });

    await expect(handleChargeRefunded(charge({ payment_intent: null }))).resolves.toBeUndefined();
    expect(payment().status).toBe("succeeded");
  });
});
