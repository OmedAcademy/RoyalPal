"use client";

import { useActionState } from "react";
import { signup, type AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { fieldInputClass, fieldLabelClass } from "@/components/ui/field-styles";

const initialState: AuthActionState = {};

const roleTileClass =
  "flex cursor-pointer flex-col gap-0.5 rounded-xl border border-hairline-strong bg-surface px-4 py-3 text-center transition-[border-color,background-color,box-shadow] duration-200 hover:border-royal has-[:checked]:border-royal has-[:checked]:bg-[color:color-mix(in_srgb,var(--royal)_6%,transparent)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[color:var(--ring)]";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signup, initialState);

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
      <fieldset className="flex flex-col gap-2">
        <legend className={`mb-1 ${fieldLabelClass}`}>I want to join as a…</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className={roleTileClass}>
            <input
              type="radio"
              name="role"
              value="student"
              defaultChecked
              required
              className="sr-only"
            />
            <span className="text-sm font-semibold">Student</span>
            <span className="text-muted text-xs">I want to learn</span>
          </label>
          <label className={roleTileClass}>
            <input type="radio" name="role" value="tutor" required className="sr-only" />
            <span className="text-sm font-semibold">Tutor</span>
            <span className="text-muted text-xs">I want to teach</span>
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fullName" className={fieldLabelClass}>
          Full name
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          required
          autoComplete="name"
          placeholder="Your name"
          className={fieldInputClass}
        />
      </div>

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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={fieldLabelClass}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
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
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
