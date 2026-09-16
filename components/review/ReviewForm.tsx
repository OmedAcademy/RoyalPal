"use client";

import { useActionState, useState } from "react";
import { createReview, type ReviewActionState } from "@/lib/actions/review";

const initialState: ReviewActionState = {};

const RATING_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Very good",
  5: "Excellent",
};

/**
 * Collapsed "Leave a review" button that expands into the rating + comment
 * form. Rendered only for the student's own completed, not-yet-reviewed
 * bookings (see BookingCard), but the server action and RLS re-enforce all
 * of that regardless.
 */
export function ReviewForm({ bookingId, tutorName }: { bookingId: string; tutorName: string }) {
  const [state, formAction, pending] = useActionState(createReview, initialState);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);

  if (state.message) {
    return (
      <p role="status" className="text-sm text-green-700 dark:text-green-400">
        {state.message}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium dark:border-white/20"
      >
        Leave a review
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md bg-black/[.03] p-3 dark:bg-white/[.05]"
    >
      <input type="hidden" name="bookingId" value={bookingId} />

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">How was your lesson with {tutorName}?</legend>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={value}
                required
                checked={rating === value}
                onChange={() => setRating(value)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={`text-2xl ${value <= rating ? "text-amber-500" : "text-zinc-300 dark:text-zinc-600"}`}
              >
                ★
              </span>
              <span className="sr-only">
                {value} star{value === 1 ? "" : "s"} — {RATING_LABELS[value]}
              </span>
            </label>
          ))}
          {rating > 0 && (
            <span className="ml-2 text-sm text-zinc-600 dark:text-zinc-400">
              {RATING_LABELS[rating]}
            </span>
          )}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={`comment-${bookingId}`} className="text-sm font-medium">
          Comment <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <textarea
          id={`comment-${bookingId}`}
          name="comment"
          rows={3}
          maxLength={1000}
          className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          placeholder="What did you work on? Would you recommend this tutor?"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || rating === 0}
          className="bg-foreground text-background w-fit rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Submitting..." : "Submit review"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-zinc-500 underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
