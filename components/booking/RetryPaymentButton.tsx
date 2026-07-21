"use client";

import { useActionState } from "react";
import { retryBookingPayment, type BookingActionState } from "@/lib/actions/booking";

const initialState: BookingActionState = {};

export function RetryPaymentButton({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState(retryBookingPayment, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <button
        type="submit"
        disabled={pending}
        className="bg-foreground text-background rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60"
      >
        {pending ? "Redirecting..." : "Complete payment"}
      </button>
      {state.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}
