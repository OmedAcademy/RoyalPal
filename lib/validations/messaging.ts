import { z } from "zod";

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Write a message first")
    // Matches the CHECK constraint in migration 0032, so the database and the
    // form agree on the limit rather than the user discovering it as a 500.
    .max(4000, "Messages are limited to 4000 characters"),
});

export const markConversationReadSchema = z.object({
  conversationId: z.string().uuid(),
});
