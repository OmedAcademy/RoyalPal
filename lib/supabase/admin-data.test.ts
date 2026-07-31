import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * Acceptance criterion 7: /admin/payments must show payout and dispute
 * state for every row.
 *
 * The failure mode worth testing is the data layer, not the JSX: a column
 * added to the table and to the row type but forgotten in listPayments'
 * `select` string would render as "—" for every payment forever, with
 * nothing — not typecheck, not the build — catching it. That is exactly
 * what these assertions pin.
 *
 * The rendering itself is covered by typecheck and the production build;
 * this project has no React component/RSC test harness and adding one is
 * outside this milestone's scope.
 */

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));

const { listPayments } = await import("@/lib/supabase/admin-data");

beforeEach(() => {
  fake = createFakeSupabase({
    payments: [
      {
        id: "p1",
        booking_id: "b1",
        amount_cents: 5000,
        currency: "usd",
        status: "succeeded",
        created_at: "2026-07-01T00:00:00.000Z",
        paid_at: "2026-07-01T00:00:00.000Z",
        transfer_status: "paid",
        dispute_status: null,
        bookings: null,
      },
      {
        id: "p2",
        booking_id: "b2",
        amount_cents: 2000,
        currency: "usd",
        status: "succeeded",
        created_at: "2026-07-02T00:00:00.000Z",
        paid_at: "2026-07-02T00:00:00.000Z",
        transfer_status: "reversed",
        dispute_status: "lost",
        bookings: null,
      },
    ],
  });
});

describe("listPayments — payout and dispute visibility", () => {
  it("selects and maps transfer_status through to the admin row", async () => {
    const rows = await listPayments();

    expect(rows.map((r) => r.transfer_status)).toEqual(
      expect.arrayContaining(["paid", "reversed"]),
    );
  });

  it("selects and maps dispute_status through to the admin row", async () => {
    const rows = await listPayments();

    const disputed = rows.find((r) => r.booking_id === "b2");
    expect(disputed?.dispute_status).toBe("lost");
  });

  it("represents 'no transfer applies' as null rather than inventing a status", async () => {
    // A lesson paid before its tutor connected an account is a plain
    // platform charge — there is no payout to report, which is different
    // from a payout that failed.
    fake.db.payments[0].transfer_status = null;

    const rows = await listPayments();

    expect(rows.find((r) => r.booking_id === "b1")?.transfer_status).toBeNull();
  });

  it("exposes booking_id so a row can be acted on (refund)", async () => {
    const rows = await listPayments();

    expect(rows.every((r) => typeof r.booking_id === "string")).toBe(true);
  });
});
