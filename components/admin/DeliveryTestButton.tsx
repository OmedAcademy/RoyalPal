"use client";

import { useActionState } from "react";
import { sendDeliveryTest, type DeliveryTestState } from "@/lib/actions/admin";

const initial: DeliveryTestState = {};

/**
 * Sends a test notification to the signed-in admin and shows each channel's
 * own answer — including the provider's error text, which is the whole point.
 */
export function DeliveryTestButton() {
  const [state, action, pending] = useActionState(sendDeliveryTest, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <button
        type="submit"
        disabled={pending}
        className="bg-royal text-royal-contrast inline-flex min-h-11 w-fit items-center rounded-full px-5 text-sm font-medium transition-opacity disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send a test to myself"}
      </button>

      {state.results ? (
        <ul aria-live="polite" className="flex flex-col gap-2">
          {state.results.map((result) => (
            <li
              key={result.channel}
              className="border-hairline bg-surface flex flex-col gap-1 rounded-xl border p-3 text-sm"
            >
              <span className="flex items-center gap-2 font-medium">
                <span aria-hidden="true">{result.ok ? "✅" : "⚠️"}</span>
                <span className="capitalize">{result.channel}</span>
                <span className="sr-only">{result.ok ? "delivered" : "failed"}</span>
              </span>
              <span className="text-muted">{result.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {state.message ? <p className="text-sm text-emerald-700">{state.message}</p> : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
