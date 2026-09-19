"use client";

import { useActionState, useState } from "react";
import { hideReview, unhideReview, type AdminActionState } from "@/lib/actions/admin";
import { fieldInputClass } from "@/components/ui/field-styles";

const initial: AdminActionState = {};

const BUTTON =
  "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50";

export function ReviewModerationActions({
  reviewId,
  hidden,
  hiddenReason,
}: {
  reviewId: string;
  hidden: boolean;
  hiddenReason: string | null;
}) {
  const [hideState, hideAction, hiding] = useActionState(hideReview, initial);
  const [restoreState, restoreAction, restoring] = useActionState(unhideReview, initial);
  const [open, setOpen] = useState(false);

  if (hidden) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-muted text-xs">Hidden{hiddenReason ? `: ${hiddenReason}` : ""}</span>
        <form action={restoreAction}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <button
            type="submit"
            disabled={restoring}
            className={`${BUTTON} border-hairline text-muted hover:bg-[color:var(--hairline)]`}
          >
            {restoring ? "…" : "Restore"}
          </button>
        </form>
        {restoreState.error && (
          <p role="alert" className="text-xs text-red-600">
            {restoreState.error}
          </p>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${BUTTON} border-red-300 text-red-700 hover:bg-red-50`}
      >
        Hide…
      </button>
    );
  }

  return (
    <form action={hideAction} className="border-hairline flex flex-col gap-2 rounded-xl border p-3">
      <input type="hidden" name="reviewId" value={reviewId} />
      <label htmlFor={`hide-${reviewId}`} className="text-xs font-medium">
        Why is this being hidden?
      </label>
      {/* Required by migration 0035's CHECK, not just by this form: a hidden
          review with no reason recorded is not an audit trail. */}
      <input
        id={`hide-${reviewId}`}
        name="reason"
        required
        maxLength={500}
        className={fieldInputClass}
        placeholder="e.g. Personal abuse, off-topic, contains personal data"
      />
      {hideState.error && (
        <p role="alert" className="text-xs text-red-600">
          {hideState.error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={hiding}
          className={`${BUTTON} border-red-300 text-red-700 hover:bg-red-50`}
        >
          {hiding ? "Hiding…" : "Hide review"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={`${BUTTON} border-hairline text-muted`}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
