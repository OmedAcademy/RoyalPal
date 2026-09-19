import { z } from "zod";
import { optionalText } from "@/lib/validations/shared";

export const createReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.coerce.number().int().min(1, "Pick a rating").max(5),
  // Optional: tolerates both an omitted field (null) and a blank textarea ("").
  comment: optionalText(1000),
});

export const replyToReviewSchema = z.object({
  reviewId: z.string().uuid(),
  // Matches the CHECK constraint in migration 0035, so the form and the
  // database agree on the limit.
  reply: z.string().trim().min(1, "Write a reply first").max(2000),
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
