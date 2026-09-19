"use client";

import { useActionState, useOptimistic, startTransition } from "react";
import { toggleFavorite, type FavoriteActionState } from "@/lib/actions/favorites";

/**
 * Optimistic on purpose. Saving a tutor is a low-stakes, high-frequency tap
 * and a round trip of latency before the heart fills makes a marketplace feel
 * broken — especially on mobile. If the action fails the optimistic value is
 * discarded on the next render and the error is announced.
 */
export function FavoriteButton({
  tutorId,
  initialFavorited,
  tutorName,
  className = "",
}: {
  tutorId: string;
  initialFavorited: boolean;
  tutorName: string;
  className?: string;
}) {
  const [state, formAction] = useActionState<FavoriteActionState, FormData>(toggleFavorite, {
    favorited: initialFavorited,
  });
  const settled = state.favorited ?? initialFavorited;
  const [optimistic, setOptimistic] = useOptimistic(settled);

  const label = optimistic ? `Remove ${tutorName} from saved tutors` : `Save ${tutorName}`;

  return (
    <form
      action={(formData) => {
        startTransition(() => setOptimistic(!optimistic));
        formAction(formData);
      }}
    >
      <input type="hidden" name="tutorId" value={tutorId} />
      <button
        type="submit"
        aria-pressed={optimistic}
        aria-label={label}
        title={label}
        className={`border-hairline-strong bg-surface hover:border-royal flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:outline-none ${className}`}
      >
        <span
          aria-hidden="true"
          className={optimistic ? "text-royal text-lg" : "text-muted text-lg"}
        >
          {optimistic ? "♥" : "♡"}
        </span>
        {state.error && <span className="role-alert sr-only">{state.error}</span>}
      </button>
      {state.error && (
        <p role="alert" className="sr-only">
          {state.error}
        </p>
      )}
    </form>
  );
}
