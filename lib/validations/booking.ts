import { z } from "zod";
import { optionalText } from "@/lib/validations/shared";

export const createBookingSchema = z.object({
  tutorId: z.string().uuid(),
  subjectId: z.coerce.number().int().positive(),
  startAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid start time"),
  durationMinutes: z.coerce
    .number()
    .int()
    .refine((v) => v === 30 || v === 60, "Invalid lesson duration"),
  lessonType: z.enum(["standard", "trial"]),
});

export type CreateBookingInput = z.input<typeof createBookingSchema>;

export const retryBookingPaymentSchema = z.object({
  bookingId: z.string().uuid(),
});

export const cancelBookingSchema = z.object({
  bookingId: z.string().uuid(),
  // The cancel button submits no reason field at all, so this must accept
  // null — see optionalText for the bug this fixes.
  reason: optionalText(500),
});

export const rescheduleBookingSchema = z.object({
  bookingId: z.string().uuid(),
  startAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid start time"),
  reason: optionalText(500),
});
