"use client";

import { useActionState, useState } from "react";
import {
  setTutorVerification,
  TUTOR_REJECTION_REASONS,
  type AdminActionState,
} from "@/lib/actions/admin";
import { fieldInputClass } from "@/components/ui/field-styles";
import type { TutorVerificationStatus } from "@/types/database";

const initial: AdminActionState = {};

const BUTTON_BASE =
  "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50";

function SimpleAction({
  tutorId,
  status,
  label,
  toneClass,
}: {
  tutorId: string;
  status: "approved" | "pending";
  label: string;
  toneClass: string;
}) {
  const [state, action, pending] = useActionState(setTutorVerification, initial);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="tutorId" value={tutorId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        disabled={pending}
        className={`${BUTTON_BASE} ${toneClass}`}
        title={state.error ?? undefined}
      >
        {pending ? "…" : label}
      </button>
    </form>
  );
}

/**
 * Rejecting now requires a reason.
 *
 * It used to be one click, which meant the tutor got "please review and update
 * your profile" and no way of knowing what was wrong — a support ticket by
 * construction. The reason is validated server-side too (see
 * setTutorVerification), so this form is the prompt rather than the rule.
 */
function RejectAction({ tutorId }: { tutorId: string }) {
  const [state, action, pending] = useActionState(setTutorVerification, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${BUTTON_BASE} border-red-300 text-red-700 hover:bg-red-50`}
      >
        Reject…
      </button>
    );
  }

  return (
    <form
      action={action}
      className="border-hairline flex w-full flex-col gap-2 rounded-xl border p-3"
    >
      <input type="hidden" name="tutorId" value={tutorId} />
      <input type="hidden" name="status" value="rejected" />

      <label htmlFor={`reason-${tutorId}`} className="text-xs font-medium">
        Reason (the tutor sees this)
      </label>
      <select
        id={`reason-${tutorId}`}
        name="reason"
        required
        defaultValue=""
        className={fieldInputClass}
      >
        <option value="" disabled>
          Choose a reason
        </option>
        {TUTOR_REJECTION_REASONS.map((reason) => (
          <option key={reason} value={reason}>
            {reason}
          </option>
        ))}
      </select>

      <label htmlFor={`notes-${tutorId}`} className="text-xs font-medium">
        Detail <span className="text-muted font-normal">(optional, also shown to them)</span>
      </label>
      <textarea
        id={`notes-${tutorId}`}
        name="notes"
        rows={2}
        maxLength={2000}
        className={`${fieldInputClass} resize-y`}
        placeholder="What specifically needs to change?"
      />

      {state.error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className={`${BUTTON_BASE} border-red-300 text-red-700 hover:bg-red-50`}
        >
          {pending ? "Rejecting…" : "Reject"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={`${BUTTON_BASE} border-hairline text-muted`}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Contextual verification controls based on the tutor's current status. */
export function TutorVerifyActions({
  tutorId,
  status,
}: {
  tutorId: string;
  status: TutorVerificationStatus;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {status !== "approved" && (
        <SimpleAction
          tutorId={tutorId}
          status="approved"
          label="Approve"
          toneClass="border-emerald-300 text-emerald-800 hover:bg-emerald-50"
        />
      )}
      {status !== "rejected" && <RejectAction tutorId={tutorId} />}
      {status !== "pending" && (
        <SimpleAction
          tutorId={tutorId}
          status="pending"
          label="Reset"
          toneClass="border-hairline text-muted hover:bg-[color:var(--hairline)]"
        />
      )}
    </div>
  );
}
