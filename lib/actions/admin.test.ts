import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * refundBooking — the admin-triggered refund request.
 *
 * Scope: only the destination-charge refund path added in this milestone.
 * setTutorVerification/setUserStatus are pre-existing and untested
 * elsewhere; not retroactively covered here.
 *
 * Key property under test: this action only ever CALLS Stripe. It never
 * marks payments/bookings refunded itself — that's handleChargeRefunded's
 * job once the webhook confirms it (lib/stripe/webhook-handlers.test.ts).
 */

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOKING = "44444444-4444-4444-8444-444444444444";

let fake: ReturnType<typeof createFakeSupabase>;
const refundBookingPayment = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));
// Mocked rather than stubbing STRIPE_SECRET_KEY: no key-shaped placeholder
// belongs in a committed file, and the behaviour under test is the action's
// branching, not env parsing. Flip `stripeConfigured` to exercise the
// unconfigured path.
let stripeConfigured = true;
vi.mock("@/lib/stripe/client", () => ({ isStripeConfigured: () => stripeConfigured }));

vi.mock("@/lib/stripe/refunds", () => ({
  refundBookingPayment: (...a: unknown[]) => refundBookingPayment(...a),
}));
vi.mock("@/lib/notifications/service", () => ({
  NotificationService: { emit: vi.fn(), emitMany: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { refundBooking, setUserStatus } = await import("@/lib/actions/admin");

function seed(opts: { paymentStatus?: string | null; user?: string | null } = {}) {
  fake = createFakeSupabase(
    {
      profiles: [{ id: ADMIN, role: "admin" }],
      payments: [
        ...(opts.paymentStatus === null
          ? []
          : [
              {
                booking_id: BOOKING,
                status: opts.paymentStatus ?? "succeeded",
                stripe_payment_intent_id: "pi_1",
              },
            ]),
      ],
      admin_actions: [],
    },
    opts.user === undefined ? { id: ADMIN } : opts.user ? { id: opts.user } : null,
  );
}

function form(notes?: string): FormData {
  const fd = new FormData();
  fd.set("bookingId", BOOKING);
  if (notes !== undefined) fd.set("notes", notes);
  return fd;
}

beforeEach(() => {
  stripeConfigured = true;
  seed();
  refundBookingPayment.mockReset();
  refundBookingPayment.mockResolvedValue({ id: "re_1" });
});

describe("refundBooking — authorization", () => {
  it("refuses a non-admin caller", async () => {
    seed({ user: null });
    const res = await refundBooking({}, form());

    expect(res.error).toBe("Not signed in");
    expect(refundBookingPayment).not.toHaveBeenCalled();
  });
});

describe("refundBooking — preconditions", () => {
  it("refuses when no payment exists for the booking", async () => {
    seed({ paymentStatus: null });
    const res = await refundBooking({}, form());

    expect(res.error).toBe("No payment found for this booking");
    expect(refundBookingPayment).not.toHaveBeenCalled();
  });

  it("refuses a payment that is already refunded", async () => {
    seed({ paymentStatus: "refunded" });
    const res = await refundBooking({}, form());

    expect(res.error).toBe("This payment has already been refunded");
    expect(refundBookingPayment).not.toHaveBeenCalled();
  });

  it("refuses a payment that never succeeded", async () => {
    seed({ paymentStatus: "failed" });
    const res = await refundBooking({}, form());

    expect(res.error).toBe("Only a succeeded payment can be refunded");
    expect(refundBookingPayment).not.toHaveBeenCalled();
  });
});

describe("refundBooking — success path", () => {
  it("calls Stripe with the booking's PaymentIntent id", async () => {
    await refundBooking({}, form("Student requested a refund"));

    expect(refundBookingPayment).toHaveBeenCalledWith({ paymentIntentId: "pi_1" });
  });

  it("does not itself mark the payment refunded — that's the webhook's job", async () => {
    await refundBooking({}, form());

    expect(fake.db.payments[0].status).toBe("succeeded");
  });

  it("records the admin action with the given notes", async () => {
    await refundBooking({}, form("Duplicate booking"));

    expect(fake.db.admin_actions).toHaveLength(1);
    expect(fake.db.admin_actions[0]).toMatchObject({
      admin_id: ADMIN,
      action: "refund_initiated",
      target_id: BOOKING,
      notes: "Duplicate booking",
    });
  });

  it("returns a success message without claiming the refund has settled", async () => {
    const res = await refundBooking({}, form());

    expect(res.message).toContain("Refund requested");
  });
});

describe("refundBooking — failure isolation", () => {
  it("surfaces the Stripe error but does not log an admin action for a failed request", async () => {
    refundBookingPayment.mockRejectedValue(new Error("No such payment_intent"));

    const res = await refundBooking({}, form());

    expect(res.error).toBe("Stripe refund failed: No such payment_intent");
    expect(fake.db.admin_actions).toHaveLength(0);
  });
});

describe("refundBooking — graceful degradation", () => {
  it("names the real problem rather than reporting a Stripe failure", async () => {
    stripeConfigured = false;

    const res = await refundBooking({}, form());

    expect(res.error).toBe(
      "Stripe is not configured on this deployment — refunds are unavailable.",
    );
    expect(refundBookingPayment).not.toHaveBeenCalled();
    expect(fake.db.admin_actions).toHaveLength(0);
  });
});

describe("setUserStatus — suspension must end the session (SEC-3)", () => {
  const VICTIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function seedUsers(callerRole: "admin" | "student" = "admin") {
    fake = createFakeSupabase(
      {
        profiles: [
          { id: ADMIN, role: callerRole },
          { id: VICTIM, role: "student", status: "active" },
        ],
        admin_actions: [],
      },
      { id: ADMIN },
    );
  }

  function form(status: string) {
    const f = new FormData();
    f.set("userId", VICTIM);
    f.set("status", status);
    return f;
  }

  it("revokes the account's sessions when suspending", async () => {
    // Writing profiles.status alone leaves a valid, refreshable JWT. Migration
    // 0042 stops a suspended account from writing through PostgREST, but the
    // session itself has to die too — otherwise suspension is a column change
    // the holder of the token never notices.
    seedUsers();

    const res = await setUserStatus({}, form("suspended"));

    expect(res.error).toBeUndefined();
    expect(fake.db.profiles.find((p) => p.id === VICTIM)?.status).toBe("suspended");

    const revocation = fake.authAdminCalls.find((c) => c.id === VICTIM);
    expect(revocation, "suspension must revoke the session, not just set a column").toBeDefined();
    expect(revocation!.method).toBe("updateUserById");
    expect(revocation!.attrs.ban_duration).toBeTruthy();
    expect(revocation!.attrs.ban_duration).not.toBe("none");
  });

  it("lifts the revocation when reactivating", async () => {
    // A reactivated account that stays banned in GoTrue can never sign in
    // again, which would turn a reversible moderation action into a permanent
    // lockout.
    seedUsers();

    const res = await setUserStatus({}, form("active"));

    expect(res.error).toBeUndefined();
    const revocation = fake.authAdminCalls.find((c) => c.id === VICTIM);
    expect(revocation).toBeDefined();
    expect(revocation!.attrs.ban_duration).toBe("none");
  });

  it("does not revoke anything when the caller is not an admin", async () => {
    seedUsers("student");

    const res = await setUserStatus({}, form("suspended"));

    expect(res.error).toBe("Admins only");
    expect(fake.authAdminCalls).toHaveLength(0);
  });
});
