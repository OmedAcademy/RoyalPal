import { z } from "zod";

const CATEGORIES = [
  "account",
  "booking",
  "payment",
  "technical",
  "report_user",
  "safeguarding",
  "other",
] as const;

const STATUSES = ["open", "in_progress", "waiting_on_user", "resolved", "closed"] as const;

export const createTicketSchema = z.object({
  category: z.enum(CATEGORIES, { message: "Choose what your request is about" }),
  // Bounds match the CHECK constraints in migration 0031 so the form and the
  // database agree, rather than the user meeting the limit as a 500.
  subject: z
    .string()
    .trim()
    .min(1, "Give your request a short title")
    .max(200, "Keep the title under 200 characters"),
  body: z
    .string()
    .trim()
    .min(1, "Describe what happened")
    .max(5000, "Keep the description under 5000 characters"),
});

export const ticketReplySchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1, "Write a reply first").max(5000),
});

export const updateTicketSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(STATUSES),
});
