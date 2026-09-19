"use client";

import { useActionState, useState } from "react";
import { replyToReview, type ReviewActionState } from "@/lib/actions/review";
import { Button } from "@/components/ui/Button";

const initialState: ReviewActionState = {};

/**
 * A tutor's one reply. The "once" is enforced by migration 0035's column lock,
 * not by hiding this form — so the confirmation copy can say "once" honestly.
 */
export function ReviewReplyForm({ reviewId }: { reviewId: string }) {
  const [state, formAction, pending] = useActionState(replyToReview, initialState);
  const [open, setOpen] = useState(false);

  if (state.message) {
    return (
      <p role="status" className="text-sm text-green-700 dark:text-green-400">
        {state.message}
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Reply
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <label htmlFor={`reply-${reviewId}`} className="text-muted text-xs font-medium">
        Your reply is public, and you can only write one.
      </label>
      <textarea
        id={`reply-${reviewId}`}
        name="reply"
        rows={3}
        required
        maxLength={2000}
        className="border-hairline-strong bg-surface focus:border-royal w-full resize-y rounded-xl border px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[color:var(--ring)] focus:outline-none"
        placeholder="Thank them, or give your side — briefly and politely."
      />
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Posting…" : "Post reply"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
