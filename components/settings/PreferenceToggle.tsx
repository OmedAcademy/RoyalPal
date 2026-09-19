"use client";

import { useActionState, useOptimistic, startTransition } from "react";
import { updateNotificationPreference, type AccountActionState } from "@/lib/actions/account";

/**
 * A single on/off control for one channel of one category.
 *
 * Rendered as a form rather than a checkbox with an onChange handler so it
 * works without JavaScript — which matters more here than elsewhere, because
 * "I turned notifications off and they kept coming" is the kind of failure
 * people do not report, they just stop trusting the product.
 */
export function PreferenceToggle({
  category,
  channel,
  label,
  enabled,
}: {
  category: string;
  channel: "email" | "push";
  label: string;
  enabled: boolean;
}) {
  const [state, formAction] = useActionState<AccountActionState, FormData>(
    updateNotificationPreference,
    {},
  );
  const [optimistic, setOptimistic] = useOptimistic(enabled);

  return (
    <form
      action={(formData) => {
        startTransition(() => setOptimistic(!optimistic));
        formAction(formData);
      }}
    >
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="enabled" value={optimistic ? "false" : "true"} />
      <button
        type="submit"
        aria-pressed={optimistic}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
          optimistic
            ? "border-royal bg-royal text-royal-contrast"
            : "border-hairline-strong text-muted"
        }`}
      >
        <span aria-hidden="true">{optimistic ? "✓" : "○"}</span>
        {label}
      </button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
