import { z } from "zod";

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
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
});
