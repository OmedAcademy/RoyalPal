import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * createReview — REV-1.
 *
 * The action's pre-check is weaker than the policy it is standing in front of.
 * Migration 0042 requires a SUCCEEDED PAYMENT on the booking; the action
 * checked only that the booking exists and is completed. So a refusal the
 * action could have explained instead arrived as an RLS error, and the action
 * handed `error.message` straight to the page — raw Postgres text, to a
 * student, at the moment they tried to say something about their lesson.
 */

const STUDENT = "11111111-1111-4111-8111-111111111111";
const TUTOR = "22222222-2222-4222-8222-222222222222";
const BOOKING = "44444444-4444-4444-8444-444444444444";

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));
vi.mock("@/lib/supabase/queries", () => ({
  activeUserOrError: async () => ({ user: { id: STUDENT } }),
}));
vi.mock("@/lib/notifications/service", () => ({
  NotificationService: { emit: vi.fn(), emitMany: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createReview } = await import("@/lib/actions/review");

function seed(opts: { bookingStatus?: string; paymentStatus?: string | null } = {}) {
  fake = createFakeSupabase(
    {
      bookings: [
        {
          id: BOOKING,
          student_id: STUDENT,
          tutor_id: TUTOR,
          status: opts.bookingStatus ?? "completed",
        },
      ],
      payments:
        opts.paymentStatus === null
          ? []
          : [{ booking_id: BOOKING, status: opts.paymentStatus ?? "succeeded" }],
      reviews: [],
    },
    { id: STUDENT },
  );
}

function form(rating = 5, comment = "Patient and clear.") {
  const fd = new FormData();
  fd.set("bookingId", BOOKING);
  fd.set("rating", String(rating));
  fd.set("comment", comment);
  return fd;
}

beforeEach(() => seed());

describe("createReview — refusals a person can act on", () => {
  it("explains an unpaid lesson instead of letting RLS refuse it", async () => {
    seed({ paymentStatus: "requires_payment" });

    const res = await createReview({}, form());

    expect(res.error).toMatch(/paid|payment/i);
    expect(fake.db.reviews).toHaveLength(0);
  });

  it("explains a booking with no payment at all", async () => {
    seed({ paymentStatus: null });

    const res = await createReview({}, form());

    expect(res.error).toMatch(/paid|payment/i);
  });

  it("never shows raw database text to a student", async () => {
    // The failure this guards is "new row violates row-level security policy
    // for table \\"reviews\\"" appearing under a review form.
    seed({ paymentStatus: "requires_payment" });

    const res = await createReview({}, form());

    expect(res.error).not.toMatch(/row-level security|violates|relation|postgres|constraint/i);
  });

  it("still refuses a lesson that has not happened yet, in the same voice", async () => {
    seed({ bookingStatus: "confirmed" });

    const res = await createReview({}, form());

    expect(res.error).toMatch(/completed/i);
  });
});

describe("createReview — the path that should work", () => {
  it("posts a review for a completed, paid lesson", async () => {
    const res = await createReview({}, form());

    expect(res.error).toBeUndefined();
    expect(res.message).toMatch(/thanks/i);
    expect(fake.db.reviews).toHaveLength(1);
    expect(fake.db.reviews[0]).toMatchObject({ booking_id: BOOKING, rating: 5 });
  });
});
