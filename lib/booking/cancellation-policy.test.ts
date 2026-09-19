import { describe, it, expect } from "vitest";
import {
  resolveCancellation,
  isCancellable,
  FREE_CANCELLATION_HOURS,
} from "@/lib/booking/cancellation-policy";

const NOW = new Date("2026-09-19T12:00:00Z");
const PRICE = 5000;

const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * 3_600_000);

describe("resolveCancellation", () => {
  it("charges nothing, and promises nothing, for an unpaid booking", () => {
    const outcome = resolveCancellation({
      status: "pending_payment",
      startAt: at(72),
      pricePaidCents: PRICE,
      cancelledBy: "student",
      now: NOW,
    });
    expect(outcome.refundOwedCents).toBe(0);
    expect(outcome.policy).toBe("unpaid_no_charge");
    // The wording matters: this is not a refund and must not read as one.
    expect(outcome.explanation).toMatch(/haven't been charged/);
  });

  it("refunds a student in full outside the window", () => {
    const outcome = resolveCancellation({
      status: "confirmed",
      startAt: at(FREE_CANCELLATION_HOURS + 1),
      pricePaidCents: PRICE,
      cancelledBy: "student",
      now: NOW,
    });
    expect(outcome.refundOwedCents).toBe(PRICE);
    expect(outcome.policy).toBe("student_outside_window_full_refund");
  });

  it("treats exactly the boundary as outside the window, in the student's favour", () => {
    const outcome = resolveCancellation({
      status: "confirmed",
      startAt: at(FREE_CANCELLATION_HOURS),
      pricePaidCents: PRICE,
      cancelledBy: "student",
      now: NOW,
    });
    expect(outcome.refundOwedCents).toBe(PRICE);
  });

  it("refunds nothing a minute inside the window", () => {
    const outcome = resolveCancellation({
      status: "confirmed",
      startAt: new Date(at(FREE_CANCELLATION_HOURS).getTime() - 60_000),
      pricePaidCents: PRICE,
      cancelledBy: "student",
      now: NOW,
    });
    expect(outcome.refundOwedCents).toBe(0);
    expect(outcome.policy).toBe("student_inside_window_no_refund");
  });

  it("refunds nothing for a lesson that has already started or finished", () => {
    for (const hours of [-0.5, -2, -100]) {
      const outcome = resolveCancellation({
        status: "confirmed",
        startAt: at(hours),
        pricePaidCents: PRICE,
        cancelledBy: "student",
        now: NOW,
      });
      expect(outcome.refundOwedCents, `${hours}h`).toBe(0);
    }
  });

  it("refunds the student in full when the TUTOR cancels, at any notice", () => {
    for (const hours of [200, FREE_CANCELLATION_HOURS, 1, 0.1, -1]) {
      const outcome = resolveCancellation({
        status: "confirmed",
        startAt: at(hours),
        pricePaidCents: PRICE,
        cancelledBy: "tutor",
        now: NOW,
      });
      expect(outcome.refundOwedCents, `${hours}h`).toBe(PRICE);
      expect(outcome.policy).toBe("tutor_cancelled_full_refund");
    }
  });

  it("refunds in full when RoyalPal cancels", () => {
    for (const by of ["admin", "system"] as const) {
      const outcome = resolveCancellation({
        status: "confirmed",
        startAt: at(1),
        pricePaidCents: PRICE,
        cancelledBy: by,
        now: NOW,
      });
      expect(outcome.refundOwedCents, by).toBe(PRICE);
    }
  });

  it("never owes more than was paid, or a negative amount", () => {
    for (const by of ["student", "tutor", "admin", "system"] as const) {
      for (const hours of [-5, 0, 1, 48]) {
        for (const price of [0, 1, PRICE]) {
          const { refundOwedCents } = resolveCancellation({
            status: "confirmed",
            startAt: at(hours),
            pricePaidCents: price,
            cancelledBy: by,
            now: NOW,
          });
          expect(refundOwedCents).toBeGreaterThanOrEqual(0);
          expect(refundOwedCents).toBeLessThanOrEqual(price);
        }
      }
    }
  });
});

describe("isCancellable", () => {
  it("allows only the two live states", () => {
    expect(isCancellable("pending_payment")).toBe(true);
    expect(isCancellable("confirmed")).toBe(true);
    expect(isCancellable("completed")).toBe(false);
    expect(isCancellable("cancelled")).toBe(false);
    expect(isCancellable("refunded")).toBe(false);
  });
});
