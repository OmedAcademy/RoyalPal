import { z } from "zod";

/**
 * An optional free-text form field, normalized to `string | null`.
 *
 * Why this exists: `FormData.get()` returns **null** for a field the form
 * never rendered, and **""** for one that was rendered but left blank.
 * `z.string().optional()` accepts `undefined` but NOT `null`, and
 * `.or(z.literal(""))` doesn't cover `null` either — so any action whose UI
 * omits an optional input failed validation with a generic "Invalid input".
 *
 * That was a live P0: CancelBookingButton submits only `bookingId`, so every
 * cancellation returned "Invalid input" instead of cancelling the lesson.
 * Regression coverage: lib/actions/booking.test.ts ("cancels and notifies the
 * other participant" / "requires authentication" both post no reason field).
 */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null));
