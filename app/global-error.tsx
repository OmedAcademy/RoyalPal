"use client";

/**
 * Last-resort boundary for errors thrown in the root layout itself, where
 * the normal error boundary can't render. Must supply its own <html>/<body>
 * and cannot rely on app styles being present, so it is deliberately
 * self-contained inline CSS.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f8f5ee",
          color: "#12233d",
          fontFamily: "Georgia, 'Times New Roman', serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>RoyalPal is temporarily unavailable</h1>
          <p style={{ fontFamily: "Arial, sans-serif", fontSize: 14, color: "#5b6472", margin: 0 }}>
            We hit an unexpected problem. Please try again in a moment.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                color: "#8891a3",
                marginTop: 12,
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              border: 0,
              borderRadius: 999,
              background: "#0f2d52",
              color: "#fdfcf8",
              padding: "12px 20px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
