"use client";

import { useActionState } from "react";
import { startTutorOnboarding, type ConnectActionState } from "@/lib/actions/stripe-connect";
import { Button } from "@/components/ui/Button";

const initialState: ConnectActionState = {};

export function ConnectOnboardingButton({ label }: { label: string }) {
  const [state, formAction, pending] = useActionState(startTutorOnboarding, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Redirecting to Stripe…" : label}
      </Button>
      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
    </form>
  );
}
