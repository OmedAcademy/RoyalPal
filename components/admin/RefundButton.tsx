"use client";

import { useActionState, useState } from "react";
import { refundBooking, type AdminActionState } from "@/lib/actions/admin";

const initial: AdminActionState = {};

/**
 * Refunds move real money, so this is deliberately not a single click: the
 * admin must open the form and explicitly confirm, and a reason is captured
 * for the audit log (admin_actions), even though Stripe's refund itself
 * doesn't take one. The row's own status badge only flips to "refunded"
 * once the charge.refunded webhook confirms it — this button's success
 * state means the request was sent, not that it settled.
 */
export function RefundButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(refundBooking, initial);

  if (state.message) {
    return <span className="text-xs font-medium text-emerald-700">{state.message}</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-8 items-center rounded-full border border-red-300 px-3 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
      >
        Refund
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="bookingId" value={bookingId} />
      <textarea
        name="notes"
        placeholder="Reason (for the audit log)"
        rows={2}
        className="border-hairline w-56 rounded-md border px-2 py-1 text-xs"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-8 items-center rounded-full border border-red-300 bg-red-50 px-3 text-xs font-medium text-red-700 disabled:opacity-50"
        >
          {pending ? "Refunding…" : "Confirm refund"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted inline-flex min-h-8 items-center px-2 text-xs"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
