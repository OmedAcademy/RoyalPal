"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updatePassword, type AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { fieldInputClass, fieldLabelClass } from "@/components/ui/field-styles";

const initialState: AuthActionState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  if (state.message) {
    return (
      <div className="flex flex-col gap-4">
        <div
          role="status"
          className="rounded-xl border border-green-600/25 bg-green-500/5 px-4 py-4 text-sm leading-relaxed text-green-700 dark:text-green-400"
        >
          {state.message}
        </div>
        <Link href="/" className="text-royal text-sm font-medium underline underline-offset-4">
          Continue to RoyalPal
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={fieldLabelClass}>
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          placeholder="At least 10 characters"
          aria-describedby="password-hint"
          className={fieldInputClass}
        />
        <p id="password-hint" className="text-muted text-xs">
          At least 10 characters. Avoid anything you use on another site.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className={fieldLabelClass}>
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          placeholder="Type it again"
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
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
