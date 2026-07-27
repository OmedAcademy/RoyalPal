import { z } from "zod";
import { optionalText } from "@/lib/validations/shared";

export const createReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.coerce.number().int().min(1, "Pick a rating").max(5),
  // Optional: tolerates both an omitted field (null) and a blank textarea ("").
  comment: optionalText(1000),
});
