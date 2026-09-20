import { z } from "zod";
import { optionalText } from "@/lib/validations/shared";

export const createReviewSchema = z.object({
  bookingId: z.string().uuid(),
  // Every branch carries written copy, including the ones a star widget
  // cannot produce. A form is not the only way in — the Server Action is a
  // public endpoint — and "Expected integer, received float" is the library
  // talking to itself in front of a student.
  rating: z.coerce
    .number({ error: "Pick a rating from 1 to 5" })
    .int("Pick a whole number of stars")
    .min(1, "Pick a rating")
    .max(5, "The highest rating is 5 stars"),
  // Optional: tolerates both an omitted field (null) and a blank textarea ("").
  comment: optionalText(1000),
});

export const replyToReviewSchema = z.object({
  reviewId: z.string().uuid(),
  // Matches the CHECK constraint in migration 0035, so the form and the
  // database agree on the limit.
  reply: z
    .string()
    .trim()
    .min(1, "Write a reply first")
    .max(2000, "A reply can be up to 2000 characters"),
});

export const hideReviewSchema = z.object({
  reviewId: z.string().uuid(),
  // Required, not optional: migration 0035's CHECK refuses a hidden review
  // with no reason attached, because a moderation decision with no
  // accountability recorded against it is not an audit trail.
  reason: z.string().trim().min(1, "Give a reason").max(500),
});

export const unhideReviewSchema = z.object({
  reviewId: z.string().uuid(),
});
