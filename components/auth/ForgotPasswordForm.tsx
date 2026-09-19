"use client";

import { useActionState } from "react";
import { requestPasswordReset, type AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { fieldInputClass, fieldLabelClass } from "@/components/ui/field-styles";

const initialState: AuthActionState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  // The action answers identically whether or not the address has an account,
  // so the success state is terminal: re-rendering the form underneath it
  // would invite the "try another address" probing the sameness is there to
  // prevent.
  if (state.message) {
    return (
      <div
        role="status"
        className="rounded-xl border border-green-600/25 bg-green-500/5 px-4 py-4 text-sm leading-relaxed text-green-700 dark:text-green-400"
      >
        {state.message}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={fieldLabelClass}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={fieldInputClass}
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} aria-busy={pending} className="mt-1 w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
