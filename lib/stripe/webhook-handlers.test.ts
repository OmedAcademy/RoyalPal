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
  handleTransferReversed,
  handleTransferCreated,
  handleChargeDisputeCreated,
  handleChargeDisputeUpdated,
  handlePayoutFailed,
  handlePayoutPaid,
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
    const notified = (emitMany.mock.calls[0][0] as Array<{ userId: string }>).map((n) => n.userId);
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

const ADMIN = "admin1";
const ACCT = "acct_tutor_1";

const transfer = (over: Partial<Stripe.Transfer> = {}) =>
  ({
    id: "tr_1",
    destination: ACCT,
    transfer_group: `royalpal_booking_${BOOKING}`,
    amount: 4250,
    ...over,
  }) as unknown as Stripe.Transfer;

/** A payments row shaped the way the handler's embedded select reads it. */
function payoutSeed(over: { status?: string; transfer_status?: string | null } = {}) {
  seed({
    profiles: [{ id: ADMIN, role: "admin" }],
    tutor_profiles: [{ id: TUTOR, stripe_account_id: ACCT }],
    payments: [
      {
        id: "p1",
        booking_id: BOOKING,
        stripe_payment_intent_id: "pi_1",
        status: over.status ?? "succeeded",
        transfer_status: over.transfer_status ?? null,
        bookings: { tutor_id: TUTOR },
      },
    ],
  });
}

describe("transfer.reversed", () => {
  it("ignores a transfer to an account that is not one of our tutors", async () => {
    payoutSeed();

    await handleTransferReversed(transfer({ destination: "acct_someone_else" }));

    expect(payment().transfer_status).toBeNull();
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("records an expected reversal (our own refund) without alerting anyone", async () => {
    payoutSeed({ status: "refunded" });

    await handleTransferReversed(transfer());

    expect(payment().transfer_status).toBe("reversed");
    expect(payment().transfer_status_reason).toBe("refund");
    expect(payment().stripe_transfer_id).toBe("tr_1");
    // A refund reversal is routine — alerting on it would drown the alert
    // that actually matters.
    expect(emitMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("alerts admins AND the tutor when money leaves with no refund on record", async () => {
    payoutSeed({ status: "succeeded" });

    await handleTransferReversed(transfer());

    expect(payment().transfer_status).toBe("reversed");
    expect(payment().transfer_status_reason).toBe("reversed_outside_royalpal");
    expect(emitMany).toHaveBeenCalledTimes(1);
    expect((emitMany.mock.calls[0][0] as Array<{ userId: string }>)[0].userId).toBe(ADMIN);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ userId: TUTOR, type: "transfer_reversed" });
  });

  it("does not touch the student's payment status or the booking", async () => {
    payoutSeed({ status: "succeeded" });

    await handleTransferReversed(transfer());

    expect(payment().status).toBe("succeeded");
    expect(booking().status).toBe("pending_payment");
  });

  it("is idempotent — a duplicate delivery does not re-alert", async () => {
    payoutSeed({ status: "succeeded", transfer_status: "reversed" });

    await handleTransferReversed(transfer());

    expect(emitMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("still alerts when the transfer_group names no resolvable booking", async () => {
    payoutSeed();

    await handleTransferReversed(transfer({ transfer_group: "group_something_else" }));

    // Never blind: money left one of our tutors even if the lesson is unknown.
    expect(emitMany).toHaveBeenCalledTimes(1);
    expect(payment().transfer_status).toBeNull();
  });

  it("refuses to write payout state when the booking belongs to a different tutor", async () => {
    payoutSeed();
    fake.db.payments[0].bookings = { tutor_id: "some-other-tutor" };

    await handleTransferReversed(transfer());

    expect(payment().transfer_status).toBeNull();
    expect(emitMany).toHaveBeenCalledTimes(1); // alerted, but wrote nothing
  });
});

const dispute = (over: Partial<Stripe.Dispute> = {}) =>
  ({
    id: "dp_1",
    payment_intent: "pi_1",
    amount: 5000,
    reason: "fraudulent",
    status: "warning_needs_response",
    evidence_details: { due_by: 1893456000 },
    ...over,
  }) as unknown as Stripe.Dispute;

describe("charge.dispute.created", () => {
  beforeEach(() => {
    seed({
      profiles: [{ id: ADMIN, role: "admin" }],
      payments: [
        {
          id: "p1",
          booking_id: BOOKING,
          stripe_payment_intent_id: "pi_1",
          status: "succeeded",
          stripe_dispute_id: null,
        },
      ],
    });
  });

  it("records the dispute and alerts every admin", async () => {
    await handleChargeDisputeCreated(dispute());

    expect(payment().stripe_dispute_id).toBe("dp_1");
    expect(payment().dispute_status).toBe("warning_needs_response");
    expect(emitMany).toHaveBeenCalledTimes(1);
    expect((emitMany.mock.calls[0][0] as Array<{ type: string }>)[0].type).toBe("dispute_created");
  });

  it("leaves the payment status and the booking untouched", async () => {
    await handleChargeDisputeCreated(dispute());

    // A dispute is an unadjudicated claim — it does not mean the lesson
    // didn't happen, and nothing is clawed back from the tutor here.
    expect(payment().status).toBe("succeeded");
    expect(payment().transfer_status).toBeUndefined();
    expect(booking().status).toBe("pending_payment");
  });

  it("does not notify the tutor (no money is taken from them by this handler)", async () => {
    await handleChargeDisputeCreated(dispute());

    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores a dispute for a charge that is not ours (shared Stripe account)", async () => {
    await handleChargeDisputeCreated(dispute({ payment_intent: "pi_lingora" }));

    expect(payment().stripe_dispute_id).toBeNull();
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("ignores a dispute carrying no payment_intent", async () => {
    await expect(
      handleChargeDisputeCreated(dispute({ payment_intent: null })),
    ).resolves.toBeUndefined();
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("is idempotent — the same dispute delivered twice alerts once", async () => {
    await handleChargeDisputeCreated(dispute());
    emitMany.mockClear();

    await handleChargeDisputeCreated(dispute());

    expect(emitMany).not.toHaveBeenCalled();
  });

  it("logs an error rather than silently swallowing when there is no admin to alert", async () => {
    seed({
      profiles: [],
      payments: [
        {
          id: "p1",
          booking_id: BOOKING,
          stripe_payment_intent_id: "pi_1",
          status: "succeeded",
          stripe_dispute_id: null,
        },
      ],
    });

    await handleChargeDisputeCreated(dispute());

    // The dispute is still recorded even though nobody could be told.
    expect(payment().stripe_dispute_id).toBe("dp_1");
    expect(emitMany).not.toHaveBeenCalled();
  });
});

describe("transfer.created — acceptance criteria 1-4", () => {
  it("(1) records transfer_status='paid' and the transfer id for a connected tutor's lesson", async () => {
    payoutSeed();

    await handleTransferCreated(transfer());

    expect(payment().transfer_status).toBe("paid");
    expect(payment().stripe_transfer_id).toBe("tr_1");
  });

  it("(1) never notifies anyone — a payout working is not news", async () => {
    payoutSeed();

    await handleTransferCreated(transfer());

    expect(emitMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("(2) arriving AFTER a reversal does not resurrect 'paid'", async () => {
    // Stripe guarantees neither ordering nor exactly-once delivery, so a
    // late or redelivered transfer.created can legitimately land after the
    // reversal that followed it. Reporting money as sitting with a tutor
    // who no longer has it would be a real ledger lie.
    payoutSeed({ status: "succeeded", transfer_status: "reversed" });

    await handleTransferCreated(transfer());

    expect(payment().transfer_status).toBe("reversed");
  });

  it("(2) full out-of-order sequence: created -> reversed -> created replay settles on reversed", async () => {
    payoutSeed({ status: "succeeded" });

    await handleTransferCreated(transfer());
    expect(payment().transfer_status).toBe("paid");

    await handleTransferReversed(transfer());
    expect(payment().transfer_status).toBe("reversed");

    await handleTransferCreated(transfer()); // redelivery
    expect(payment().transfer_status).toBe("reversed");
  });

  it("(3) ignores a transfer to an account that is not one of our tutors — no write, no alert", async () => {
    payoutSeed();

    await handleTransferCreated(transfer({ destination: "acct_someone_else" }));

    expect(payment().transfer_status).toBeNull();
    expect(payment().stripe_transfer_id).toBeUndefined();
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("(4) writes nothing when transfer_group names a booking belonging to a different tutor", async () => {
    payoutSeed();
    fake.db.payments[0].bookings = { tutor_id: "some-other-tutor" };

    await handleTransferCreated(transfer());

    expect(payment().transfer_status).toBeNull();
    // Unlike a reversal, this is silent: nothing bad happened, the transfer
    // simply isn't ours to record.
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("(4) writes nothing when the transfer_group is unparseable", async () => {
    payoutSeed();

    await handleTransferCreated(transfer({ transfer_group: "group_pi_3Abc" }));

    expect(payment().transfer_status).toBeNull();
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("is idempotent — a duplicate delivery is a no-op", async () => {
    payoutSeed();

    await handleTransferCreated(transfer());
    await handleTransferCreated(transfer());

    expect(payment().transfer_status).toBe("paid");
    expect(emitMany).not.toHaveBeenCalled();
  });
});

describe("charge.dispute.updated / closed — acceptance criteria 5-6", () => {
  function disputeSeed(over: { disputeId?: string | null; disputeStatus?: string | null } = {}) {
    seed({
      profiles: [{ id: ADMIN, role: "admin" }],
      payments: [
        {
          id: "p1",
          booking_id: BOOKING,
          stripe_payment_intent_id: "pi_1",
          status: "succeeded",
          stripe_dispute_id: over.disputeId === undefined ? "dp_1" : over.disputeId,
          dispute_status:
            over.disputeStatus === undefined ? "warning_needs_response" : over.disputeStatus,
        },
      ],
    });
  }

  it("(5) alerts admins when a dispute is won", async () => {
    disputeSeed();

    await handleChargeDisputeUpdated(dispute({ status: "won" }));

    expect(payment().dispute_status).toBe("won");
    expect(emitMany).toHaveBeenCalledTimes(1);
    const sent = emitMany.mock.calls[0][0] as Array<{ type: string; title: string }>;
    expect(sent[0].type).toBe("dispute_resolved");
    expect(sent[0].title).toBe("Chargeback won");
  });

  it("(5) alerts admins when a dispute is lost", async () => {
    disputeSeed();

    await handleChargeDisputeUpdated(dispute({ status: "lost" }));

    expect(payment().dispute_status).toBe("lost");
    expect((emitMany.mock.calls[0][0] as Array<{ title: string }>)[0].title).toBe(
      "Chargeback lost",
    );
  });

  it("(5) alerts EXACTLY once — closed following updated with the same outcome is a no-op", async () => {
    disputeSeed();

    await handleChargeDisputeUpdated(dispute({ status: "won" })); // charge.dispute.updated
    await handleChargeDisputeUpdated(dispute({ status: "won" })); // charge.dispute.closed

    expect(emitMany).toHaveBeenCalledTimes(1);
  });

  it("(6) an intermediate status change is recorded silently", async () => {
    disputeSeed();

    await handleChargeDisputeUpdated(dispute({ status: "under_review" }));

    expect(payment().dispute_status).toBe("under_review");
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("(6) warning_closed is not treated as an outcome (it closes an early warning, not a dispute)", async () => {
    disputeSeed();

    await handleChargeDisputeUpdated(dispute({ status: "warning_closed" }));

    expect(payment().dispute_status).toBe("warning_closed");
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("never touches the tutor — no reversal, no debit, no notification", async () => {
    disputeSeed();

    await handleChargeDisputeUpdated(dispute({ status: "lost" }));

    expect(emit).not.toHaveBeenCalled();
    expect(payment().transfer_status).toBeUndefined();
    expect(payment().status).toBe("succeeded");
  });

  it("records a dispute first seen at closing time (created was missed or never delivered)", async () => {
    disputeSeed({ disputeId: null, disputeStatus: null });

    await handleChargeDisputeUpdated(dispute({ status: "lost" }));

    expect(payment().stripe_dispute_id).toBe("dp_1");
    expect(payment().dispute_status).toBe("lost");
  });

  it("ignores a dispute for a charge that is not ours (shared Stripe account)", async () => {
    disputeSeed();

    await handleChargeDisputeUpdated(dispute({ payment_intent: "pi_lingora", status: "lost" }));

    expect(payment().dispute_status).toBe("warning_needs_response");
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("ignores a dispute carrying no payment_intent", async () => {
    disputeSeed();

    await expect(
      handleChargeDisputeUpdated(dispute({ payment_intent: null, status: "lost" })),
    ).resolves.toBeUndefined();
    expect(emitMany).not.toHaveBeenCalled();
  });
});

const richAccount = (over: Record<string, unknown> = {}) =>
  ({
    id: ACCT,
    metadata: { app: "royalpal", tutor_id: TUTOR },
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
    ...over,
  }) as unknown as Stripe.Account;

function accountSeed(over: Record<string, unknown> = {}) {
  seed({
    profiles: [{ id: ADMIN, role: "admin" }],
    tutor_profiles: [
      {
        id: TUTOR,
        stripe_account_id: ACCT,
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        stripe_details_submitted: false,
        stripe_disabled_reason: null,
        ...over,
      },
    ],
  });
}

const tutorRow = () => fake.db.tutor_profiles[0];

describe("account.updated — full Connect state", () => {
  it("mirrors payouts_enabled and details_submitted, not just charges_enabled", async () => {
    accountSeed();

    await handleAccountUpdated(
      richAccount({ charges_enabled: true, payouts_enabled: true, details_submitted: true }),
    );

    expect(tutorRow().stripe_charges_enabled).toBe(true);
    expect(tutorRow().stripe_payouts_enabled).toBe(true);
    expect(tutorRow().stripe_details_submitted).toBe(true);
  });

  it("keeps charges_enabled and payouts_enabled independent", async () => {
    // A real state, not a hypothetical: the tutor is bookable and earning,
    // but bank payouts are paused so money piles up in their Stripe balance.
    // Collapsing these two into one flag would either block a bookable tutor
    // or imply they are being paid when they are not.
    accountSeed();

    await handleAccountUpdated(
      richAccount({ charges_enabled: true, payouts_enabled: false, details_submitted: true }),
    );

    expect(tutorRow().stripe_charges_enabled).toBe(true);
    expect(tutorRow().stripe_payouts_enabled).toBe(false);
  });

  it("merges currently_due and past_due requirements", async () => {
    accountSeed();

    await handleAccountUpdated(
      richAccount({
        requirements: {
          currently_due: ["individual.id_number"],
          past_due: ["individual.verification.document"],
          disabled_reason: "requirements.past_due",
        },
      }),
    );

    expect(tutorRow().stripe_requirements_due).toEqual([
      "individual.id_number",
      "individual.verification.document",
    ]);
    expect(tutorRow().stripe_disabled_reason).toBe("requirements.past_due");
  });

  it("de-duplicates a requirement appearing in both lists", async () => {
    accountSeed();

    await handleAccountUpdated(
      richAccount({
        requirements: {
          currently_due: ["individual.id_number"],
          past_due: ["individual.id_number"],
          disabled_reason: null,
        },
      }),
    );

    expect(tutorRow().stripe_requirements_due).toEqual(["individual.id_number"]);
  });

  it("notifies a tutor whose account becomes newly restricted", async () => {
    accountSeed({ stripe_charges_enabled: true });

    await handleAccountUpdated(
      richAccount({ charges_enabled: true, requirements: { disabled_reason: "under_review" } }),
    );

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({
      userId: TUTOR,
      type: "payouts_action_required",
    });
  });

  it("does not re-notify while an account stays restricted", async () => {
    accountSeed({ stripe_disabled_reason: "under_review" });

    await handleAccountUpdated(
      richAccount({ details_submitted: true, requirements: { disabled_reason: "under_review" } }),
    );

    expect(emit).not.toHaveBeenCalled();
  });

  it("sends the activation notice only on the false->true transition", async () => {
    accountSeed({ stripe_charges_enabled: true });

    // charges_enabled was ALREADY true; only payouts_enabled changed.
    await handleAccountUpdated(richAccount({ charges_enabled: true, payouts_enabled: true }));

    expect(emit).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing we mirror actually changed", async () => {
    accountSeed({ stripe_charges_enabled: true, stripe_payouts_enabled: true });

    await handleAccountUpdated(richAccount({ charges_enabled: true, payouts_enabled: true }));

    expect(emit).not.toHaveBeenCalled();
  });
});

const payout = (over: Partial<Stripe.Payout> = {}) =>
  ({
    id: "po_1",
    amount: 12_500,
    currency: "usd",
    failure_message: "Bank account closed",
    failure_code: "account_closed",
    ...over,
  }) as unknown as Stripe.Payout;

describe("payout.failed / payout.paid", () => {
  it("notifies the tutor AND admins when a bank payout fails", async () => {
    accountSeed();

    await handlePayoutFailed(payout(), ACCT);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ userId: TUTOR, type: "payout_failed" });
    expect(emitMany).toHaveBeenCalledTimes(1);
  });

  it("ignores a payout for an account that is not one of our tutors", async () => {
    accountSeed();

    await handlePayoutFailed(payout(), "acct_someone_else");

    expect(emit).not.toHaveBeenCalled();
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("ignores a PLATFORM payout, which carries no connected account", async () => {
    // RoyalPal's own balance paying out to RoyalPal's bank is not a tutor
    // event and must never reach a tutor's notifications.
    accountSeed();

    await handlePayoutFailed(payout(), undefined);

    expect(emit).not.toHaveBeenCalled();
  });

  it("payout.paid is silent — a payout working is not news", async () => {
    accountSeed();

    await handlePayoutPaid(payout(), ACCT);

    expect(emit).not.toHaveBeenCalled();
    expect(emitMany).not.toHaveBeenCalled();
  });

  it("does not touch any payment row — payouts batch many lessons", async () => {
    accountSeed();

    await handlePayoutFailed(payout(), ACCT);

    // There is no single booking a payout belongs to, so nothing per-booking
    // may be written from this path — the seeded payment must be untouched.
    expect(payment().status).toBe("requires_payment");
    expect(payment().transfer_status).toBeUndefined();
  });
});
