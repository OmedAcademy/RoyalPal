import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * MOB-17 — two decisions that were being made in the clients.
 *
 * The 15-minute join window was hand-copied into the web BookingCard and the
 * mobile one, each carrying a comment claiming it matched the other. Two
 * copies of a number, each documenting agreement with a copy it cannot see, is
 * the arrangement where a change lands in one of them.
 *
 * `canReview` was derived from status and `reviewed` alone — weaker than the
 * RLS policy behind it, which also requires a succeeded payment (0042). So a
 * student could be shown a review form for an unpaid lesson and refused after
 * writing it, which is the same failure REV-1 fixed one layer down.
 */

const STUDENT = "11111111-1111-4111-8111-111111111111";
const TUTOR = "22222222-2222-4222-8222-222222222222";
const BOOKING = "44444444-4444-4444-8444-444444444444";

let fake: ReturnType<typeof createFakeSupabase>;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));
vi.mock("@/lib/supabase/maintenance", () => ({ runBookingMaintenance: async () => {} }));

const { getBookingsFor, JOIN_WINDOW_MINUTES } = await import("@/lib/supabase/bookings");

const START = "2026-06-01T10:00:00.000Z";

function seed(opts: { status?: string; reviewed?: boolean; paymentStatus?: string | null } = {}) {
  fake = createFakeSupabase({
    bookings: [
      {
        id: BOOKING,
        student_id: STUDENT,
        tutor_id: TUTOR,
        status: opts.status ?? "completed",
        start_at: START,
        end_at: "2026-06-01T11:00:00.000Z",
        student: { full_name: "Sam Student" },
        tutor_profiles: { profiles: { full_name: "Tara Tutor" } },
        subjects: { name: "English" },
        reviews: opts.reviewed ? { id: "rev-1" } : null,
        payments:
          opts.paymentStatus === null ? null : { status: opts.paymentStatus ?? "succeeded" },
      },
    ],
  });
}

const only = async (role: "student" | "tutor" = "student") =>
  (await getBookingsFor(role === "student" ? STUDENT : TUTOR, role))[0];

beforeEach(() => seed());

describe("join_opens_at — the window ships from the server", () => {
  it("opens exactly the window before the lesson starts", async () => {
    const booking = await only();

    const opens = new Date(booking.join_opens_at).getTime();
    expect(new Date(START).getTime() - opens).toBe(JOIN_WINDOW_MINUTES * 60_000);
  });

  it("is a timestamp, so a screen left open still reaches it", async () => {
    // A boolean computed on the server would be false forever on a page
    // rendered a minute too early.
    const booking = await only();

    expect(() => new Date(booking.join_opens_at).toISOString()).not.toThrow();
  });
});

describe("can_review — decided where the policy is", () => {
  it("is false for a completed lesson that was never paid for", async () => {
    // The clients showed a form here. The database then refused it.
    seed({ paymentStatus: "requires_payment" });

    expect((await only()).can_review).toBe(false);
  });

  it("is false when there is no payment row at all", async () => {
    seed({ paymentStatus: null });

    expect((await only()).can_review).toBe(false);
  });

  it("is true for a completed, paid, unreviewed lesson", async () => {
    expect((await only()).can_review).toBe(true);
  });

  it("is false once a review exists", async () => {
    seed({ reviewed: true });

    expect((await only()).can_review).toBe(false);
  });

  it("is false for a lesson that has not happened", async () => {
    seed({ status: "confirmed" });

    expect((await only()).can_review).toBe(false);
  });

  it("is false for the tutor, who does not review their own lesson", async () => {
    expect((await only("tutor")).can_review).toBe(false);
  });
});
