"use client";

import { useActionState } from "react";
import { cancelBooking, type BookingActionState } from "@/lib/actions/booking";

const initialState: BookingActionState = {};

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState(cancelBooking, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-60 dark:border-white/20"
      >
        {pending ? "Cancelling..." : "Cancel"}
      </button>
      {state.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}
