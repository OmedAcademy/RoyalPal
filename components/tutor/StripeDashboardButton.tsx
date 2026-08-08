"use client";

import { useActionState } from "react";
import { openStripeDashboard, type ConnectActionState } from "@/lib/actions/stripe-connect";
import { Button } from "@/components/ui/Button";

const initialState: ConnectActionState = {};

/** Sends an onboarded tutor to their Stripe Express dashboard (balance,
 * payout schedule, outstanding requirements). The link is minted per click
 * because Stripe login links are single-use and short-lived. */
export function StripeDashboardButton() {
  const [state, formAction, pending] = useActionState(openStripeDashboard, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Opening Stripe…" : "Open Stripe dashboard"}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
