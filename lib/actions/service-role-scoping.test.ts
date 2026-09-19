import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * Attack tests for the five reads that migration 0041 pushed onto the service
 * role.
 *
 * The service role bypasses RLS *and* column privileges, so each of these
 * reads is a place where the database has stopped being the thing that decides
 * who may see a tutor's connected-account id or negotiated commission rate.
 * From here on, the scoping is the code's job, and code is exactly what a test
 * has to check.
 *
 * The question in every case is the same: can a caller aim one of these reads
 * at a tutor who is not them, and get the privileged value back?
 *
 * Two of the paths take no attacker-controlled id at all (onboarding, the
 * dashboard link), so the attack is to send one anyway and prove it is
 * ignored. Two take a tutorId the caller genuinely chooses (booking), so the
 * attack is to check whether the privileged value reaches the response.
 */

const ATTACKER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VICTIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VICTIM_ACCOUNT = "acct_victim_secret";
const VICTIM_FEE_BPS = 250;

let fake: ReturnType<typeof createFakeSupabase>;
let adminFake: ReturnType<typeof createFakeSupabase> | null = null;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => (adminFake ?? fake).client }));

const createExpressAccount = vi.fn();
const createOnboardingLink = vi.fn();
const createDashboardLink = vi.fn();
vi.mock("@/lib/stripe/connect", () => ({
  createExpressAccount: (...a: unknown[]) => createExpressAccount(...a),
  createOnboardingLink: (...a: unknown[]) => createOnboardingLink(...a),
  createDashboardLink: (...a: unknown[]) => createDashboardLink(...a),
}));
vi.mock("@/lib/stripe/client", () => ({ isStripeConfigured: () => true }));
const createCheckout = vi.fn();
vi.mock("@/lib/stripe/checkout", () => ({
  createBookingCheckoutSession: (...a: unknown[]) => createCheckout(...a),
}));
const getSlots = vi.fn();
vi.mock("@/lib/supabase/availability", () => ({
  getTutorAvailableSlots: (...a: unknown[]) => getSlots(...a),
}));
vi.mock("@/lib/notifications/service", () => ({
  NotificationService: { emit: vi.fn(), notifyAdmins: vi.fn() },
}));
vi.mock("@/lib/meet/service", () => ({ MeetingService: { scheduleMeeting: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const { startTutorOnboarding, openStripeDashboard } = await import("@/lib/actions/stripe-connect");
const { createBooking } = await import("@/lib/actions/booking");

async function capture(
  fn: () => Promise<unknown>,
): Promise<{ url: string | null; value: unknown }> {
  try {
    return { url: null, value: await fn() };
  } catch (err) {
    return { url: (err as { url?: string }).url ?? null, value: null };
  }
}

/** Both tutors exist; only the VICTIM has Stripe state worth stealing. */
function seed(callerId: string | null = ATTACKER, callerRole: "tutor" | "student" = "tutor") {
  fake = createFakeSupabase(
    {
      profiles: [
        { id: ATTACKER, role: callerRole, country: "US", status: "active", full_name: "Attacker" },
        { id: VICTIM, role: "tutor", country: "US", status: "active", full_name: "Victim" },
      ],
      tutor_profiles: [
        { id: ATTACKER, stripe_account_id: null, platform_fee_bps: null },
        {
          id: VICTIM,
          stripe_account_id: VICTIM_ACCOUNT,
          platform_fee_bps: VICTIM_FEE_BPS,
          hourly_rate_cents: 5000,
          trial_price_cents: 2000,
          currency: "usd",
          verification_status: "approved",
          stripe_charges_enabled: true,
        },
      ],
      tutor_subjects: [{ tutor_id: VICTIM, subject_id: 1 }],
      subjects: [{ id: 1, name: "English" }],
      bookings: [],
      payments: [],
    },
    callerId ? { id: callerId } : null,
  );
  adminFake = null;
}

beforeEach(() => {
  seed();
  createExpressAccount.mockReset().mockResolvedValue("acct_attacker_new");
  createOnboardingLink.mockReset().mockResolvedValue("https://connect.test/setup");
  createDashboardLink.mockReset().mockResolvedValue("https://connect.test/dash");
  createCheckout.mockReset().mockResolvedValue({ url: "https://checkout.test/s" });
  getSlots.mockReset();
});

// PATH 1 ---------------------------------------------------------------------
describe("PATH 1 — app/tutor/payouts/page.tsx", () => {
  it("takes no caller-supplied id at all, so there is nothing to aim elsewhere", async () => {
    // The page reads `profile.id` from requireProfile(["tutor"]) and passes it
    // straight to .eq("id", ...). There is no route param, no search param and
    // no form field in the whole module, so an attacker has no input to bend.
    // This is asserted against the source because the absence of a parameter
    // is the security property — a behavioural test cannot prove a negative
    // about an input that does not exist.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("app/tutor/payouts/page.tsx", "utf8"),
    );
    const adminBlock = source.slice(source.indexOf("createAdminClient()"));
    const eqCall = adminBlock.slice(
      adminBlock.indexOf('.eq("id"'),
      adminBlock.indexOf(".maybeSingle"),
    );
    expect(eqCall).toContain("profile.id");
    expect(source).toContain('requireProfile(["tutor"])');
    // searchParams IS destructured on this page — for `connect` — so prove it
    // never reaches the query.
    expect(eqCall).not.toContain("searchParams");
    expect(eqCall).not.toContain("params");
  });
});

// PATH 2 ---------------------------------------------------------------------
describe("PATH 2 — startTutorOnboarding", () => {
  it("ignores a victim id smuggled in the form and never touches their account", async () => {
    const form = new FormData();
    form.set("tutorId", VICTIM);
    form.set("id", VICTIM);
    form.set("userId", VICTIM);

    await capture(() => startTutorOnboarding({}, form));

    // A brand-new account was minted for the ATTACKER; the victim's row is
    // untouched and their account id was never handed to Stripe.
    expect(createExpressAccount).toHaveBeenCalledTimes(1);
    expect(createExpressAccount.mock.calls[0][0]).toMatchObject({ tutorId: ATTACKER });
    const victimRow = fake.db.tutor_profiles.find((r) => r.id === VICTIM)!;
    expect(victimRow.stripe_account_id).toBe(VICTIM_ACCOUNT);
    expect(createOnboardingLink.mock.calls[0][0].accountId).not.toBe(VICTIM_ACCOUNT);
  });

  it("refuses a student caller outright, before any privileged read", async () => {
    seed(ATTACKER, "student");
    const res = await startTutorOnboarding({}, new FormData());
    expect(res.error).toBe("Only tutors can connect a payout account");
    expect(createExpressAccount).not.toHaveBeenCalled();
  });
});

// PATH 3 ---------------------------------------------------------------------
describe("PATH 3 — openStripeDashboard", () => {
  it("ignores a victim id in the form and never mints a link for their account", async () => {
    const form = new FormData();
    form.set("tutorId", VICTIM);
    form.set("accountId", VICTIM_ACCOUNT);

    const res = await capture(() => openStripeDashboard({}, form));

    // The attacker has no connected account, so the only correct outcome is a
    // refusal — never a dashboard link onto the victim's account.
    expect(createDashboardLink).not.toHaveBeenCalled();
    expect(res.url).toBeNull();
  });
});

// PATH 4 ---------------------------------------------------------------------
describe("PATH 4 — createBooking reads the chosen tutor's platform_fee_bps", () => {
  const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();

  function bookingForm() {
    const form = new FormData();
    form.set("tutorId", VICTIM);
    form.set("subjectId", "1");
    form.set("startAt", FUTURE);
    form.set("lessonType", "standard");
    form.set("durationMinutes", "60");
    return form;
  }

  beforeEach(() => {
    seed(ATTACKER, "student");
    getSlots.mockResolvedValue([
      { startAt: new Date(FUTURE), endAt: new Date(Date.parse(FUTURE) + 3_600_000) },
    ]);
  });

  it("never returns the commission rate to the caller", async () => {
    // tutorId here IS attacker-chosen and the read IS privileged, so this is
    // the path where a leak would actually be reachable.
    const res = await capture(() => createBooking({}, bookingForm()));

    // Non-vacuity first: the booking really was created, so the privileged
    // read definitely ran. Without this the assertions below would pass just
    // as happily on an early refusal.
    expect(fake.db.bookings).toHaveLength(1);
    expect(fake.db.bookings[0].tutor_id).toBe(VICTIM);

    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(String(VICTIM_FEE_BPS));
    expect(serialized).not.toContain("platform_fee_bps");
  });

  it("never returns the tutor's connected-account id to the caller", async () => {
    const res = await capture(() => createBooking({}, bookingForm()));
    expect(fake.db.bookings).toHaveLength(1);
    expect(JSON.stringify(res)).not.toContain(VICTIM_ACCOUNT);
  });

  it("stores the derived fee on the booking — which the student CAN read", async () => {
    // Not a failure of the five paths, but the honest boundary of what 0041
    // achieved: the commission RATE is no longer readable, while the fee it
    // produced is a column on the student's own booking row. Dividing one by
    // the other recovers the rate for the one tutor they booked. Recorded
    // here so the limit is visible rather than assumed away.
    await capture(() => createBooking({}, bookingForm()));

    const booking = fake.db.bookings[0];
    const derivedBps = Math.round(
      (Number(booking.platform_fee_cents) / Number(booking.price_cents)) * 10000,
    );
    expect(derivedBps).toBe(VICTIM_FEE_BPS);
  });
});

// PATH 5 ---------------------------------------------------------------------
describe("PATH 5 — checkout's destination-charge lookup", () => {
  const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();

  beforeEach(() => {
    seed(ATTACKER, "student");
    getSlots.mockResolvedValue([
      { startAt: new Date(FUTURE), endAt: new Date(Date.parse(FUTURE) + 3_600_000) },
    ]);
  });

  it("sends the account id to Stripe and not to the caller", async () => {
    const form = new FormData();
    form.set("tutorId", VICTIM);
    form.set("subjectId", "1");
    form.set("startAt", FUTURE);
    form.set("lessonType", "standard");
    form.set("durationMinutes", "60");

    const res = await capture(() => createBooking({}, form));

    // It reaches Stripe — that is the whole point of a destination charge —
    // and the caller gets a Stripe URL, never the acct_ id itself.
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(createCheckout.mock.calls[0][0].tutorStripeAccountId).toBe(VICTIM_ACCOUNT);
    expect(res.url ?? "").not.toContain(VICTIM_ACCOUNT);
    expect(JSON.stringify(res)).not.toContain(VICTIM_ACCOUNT);
  });
});
