"use client";

import { useActionState } from "react";
import { createTicket, type SupportActionState } from "@/lib/actions/support";
import { Button } from "@/components/ui/Button";
import { fieldInputClass, fieldLabelClass } from "@/components/ui/field-styles";

const initialState: SupportActionState = {};

const CATEGORIES = [
  { value: "booking", label: "A lesson or booking" },
  { value: "payment", label: "Payments and refunds" },
  { value: "account", label: "My account" },
  { value: "technical", label: "Something is broken" },
  { value: "report_user", label: "Report a person" },
  { value: "safeguarding", label: "Safety concern" },
  { value: "other", label: "Something else" },
];

export function NewTicketForm() {
  const [state, formAction, pending] = useActionState(createTicket, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="category" className={fieldLabelClass}>
          What&apos;s it about?
        </label>
        <select id="category" name="category" required defaultValue="" className={fieldInputClass}>
          <option value="" disabled>
            Choose a category
          </option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="subject" className={fieldLabelClass}>
          Title
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          required
          maxLength={200}
          placeholder="A short summary"
          className={fieldInputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="body" className={fieldLabelClass}>
          What happened?
        </label>
        <textarea
          id="body"
          name="body"
          rows={5}
          required
          maxLength={5000}
          placeholder="Include anything that would help us look into it — dates, lesson times, what you expected."
          className={`${fieldInputClass} resize-y`}
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

      <Button type="submit" disabled={pending} aria-busy={pending} className="self-start">
        {pending ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}
