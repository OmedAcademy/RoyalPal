import type { BookingStatus } from "@/types/database";

/**
 * The cancellation policy, as a pure function.
 *
 * Kept deliberately free of database and Stripe calls so it can be exercised
 * exhaustively in tests and quoted verbatim on the public policy page. The
 * page and the code cannot drift, because the page renders these same
 * constants.
 *
 * WHAT THIS DOES AND DOES NOT DECIDE
 * It decides what refund the student is OWED under our own policy. It does not
 * issue a refund, and it does not record one as having happened. Those are
 * separate on purpose (see migration 0037): a refund is owed by us, requested
 * from Stripe, and confirmed by Stripe, and collapsing the three is how a
 * platform tells a student their money is back when it isn't.
 */

/** Hours before the lesson inside which a student cancellation earns nothing. */
export const FREE_CANCELLATION_HOURS = 24;

export type CancelledBy = "student" | "tutor" | "admin" | "system";

export type CancellationOutcome = {
  /** Cents to refund. Always between 0 and the price paid. */
  refundOwedCents: number;
  /** The named rule that fired, stored on the booking for later explanation. */
  policy: CancellationPolicyName;
  /** One sentence, shown to the person cancelling BEFORE they confirm. */
  explanation: string;
};

export type CancellationPolicyName =
  | "unpaid_no_charge"
  | "student_outside_window_full_refund"
  | "student_inside_window_no_refund"
  | "tutor_cancelled_full_refund"
  | "admin_cancelled_full_refund";

export function resolveCancellation(params: {
  status: BookingStatus;
  startAt: Date;
  pricePaidCents: number;
  cancelledBy: CancelledBy;
  now?: Date;
}): CancellationOutcome {
  const now = params.now ?? new Date();

  // Nothing was ever taken, so there is nothing to decide. This is the common
  // case — a student abandoning checkout — and it must not be described to
  // them as a refund.
  if (params.status === "pending_payment") {
    return {
      refundOwedCents: 0,
      policy: "unpaid_no_charge",
      explanation: "You haven't been charged for this lesson, so there's nothing to refund.",
    };
  }

  // A tutor cancelling is never the student's fault, whenever it happens. The
  // window exists to protect a tutor's reserved time from a late change of
  // mind; applying it to the tutor themselves would have it protect them from
  // their own.
  if (params.cancelledBy === "tutor") {
    return {
      refundOwedCents: params.pricePaidCents,
      policy: "tutor_cancelled_full_refund",
      explanation:
        "Cancelling a confirmed lesson refunds your student in full, whenever it happens.",
    };
  }

  if (params.cancelledBy === "admin" || params.cancelledBy === "system") {
    return {
      refundOwedCents: params.pricePaidCents,
      policy: "admin_cancelled_full_refund",
      explanation: "Lessons cancelled by RoyalPal are refunded in full.",
    };
  }

  const hoursUntilStart = (params.startAt.getTime() - now.getTime()) / 3_600_000;

  if (hoursUntilStart >= FREE_CANCELLATION_HOURS) {
    return {
      refundOwedCents: params.pricePaidCents,
      policy: "student_outside_window_full_refund",
      explanation: `Cancelling more than ${FREE_CANCELLATION_HOURS} hours before the lesson refunds you in full.`,
    };
  }

  // Includes a lesson that has already started or finished: hoursUntilStart
  // goes negative and falls here, which is correct — the tutor showed up.
  return {
    refundOwedCents: 0,
    policy: "student_inside_window_no_refund",
    explanation: `This lesson starts within ${FREE_CANCELLATION_HOURS} hours, so cancelling now doesn't earn a refund — your tutor has kept the time free.`,
  };
}

/** Whether a booking is in a state that can be cancelled at all. */
export function isCancellable(status: BookingStatus): boolean {
  return status === "pending_payment" || status === "confirmed";
}
