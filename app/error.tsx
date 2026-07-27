"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Before this existed, any thrown query error in
 * a Server Component surfaced as a raw framework 500 with no way back. Now
 * failures degrade to a branded page with a working retry.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side details stay in the server logs; the digest correlates a
    // user report to the exact log entry without leaking internals.
    console.error("[route error]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-5 text-center">
      <div className="shadow-luxe border-hairline bg-surface max-w-md rounded-2xl border p-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted mt-3 text-sm leading-relaxed">
          We hit an unexpected problem loading this page. Trying again usually resolves it.
        </p>
        {error.digest && (
          <p className="text-muted mt-3 font-mono text-xs">Reference: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={reset}
          className="bg-royal text-royal-contrast shadow-luxe mt-6 inline-flex h-11 items-center rounded-full px-5 text-sm font-medium transition-transform hover:-translate-y-0.5"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
