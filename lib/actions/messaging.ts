"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";
import { sendMessageSchema, markConversationReadSchema } from "@/lib/validations/messaging";
import { markConversationRead, notifyNewMessage } from "@/lib/messaging/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/rate-limit/limiter";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "messaging-action" });

export type MessagingActionState = {
  error?: string;
  /** Set on success so the composer can clear itself. */
  sent?: boolean;
};

/**
 * Sends a message into a booking-scoped thread.
 *
 * Authorization is the database's and stays there: migration 0032's insert
 * policy requires that the caller is the named sender, is a party to the
 * conversation, AND that the conversation is still open. This action does not
 * re-check any of that — duplicating it here would create two rules free to
 * disagree, and the RLS one is the one that cannot be bypassed.
 *
 * What this adds is everything RLS structurally cannot do: the suspension
 * check (Server Actions are addressable independently of the routes they
 * appear on), a rate limit, and the notification to the other party.
 */
export async function sendMessage(
  _prevState: MessagingActionState,
  formData: FormData,
): Promise<MessagingActionState> {
  const parsed = sendMessageSchema.safeParse({
    conversationId: formData.get("conversationId"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid message" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) return { error: auth.error };

  const limit = await consumeRateLimit("sendMessage", auth.user.id);
  if (!limit.allowed) return { error: rateLimitMessage(limit) };

  const { error } = await supabase.from("messages").insert({
    conversation_id: parsed.data.conversationId,
    sender_id: auth.user.id,
    body: parsed.data.body,
  });

  if (error) {
    // The two realistic refusals are "not your conversation" and "this thread
    // is closed". Both are 42501 from RLS and neither should echo a Postgres
    // message at a person.
    log.error("message insert refused", error, { userId: auth.user.id });
    return {
      error: "That conversation isn't accepting messages. Refresh the page and try again.",
    };
  }

  // Recipient lookup happens after the write: if the insert was refused there
  // is nobody to notify, and doing it first would leak whether a conversation
  // exists to someone who has no access to it.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("student_id, tutor_id")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();

  if (conversation) {
    const recipientId =
      conversation.student_id === auth.user.id ? conversation.tutor_id : conversation.student_id;
    const { data: sender } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", auth.user.id)
      .maybeSingle();

    await notifyNewMessage({
      recipientId,
      senderName: sender?.full_name ?? "Someone",
      body: parsed.data.body,
      href: `/messages/${parsed.data.conversationId}`,
    });
  }

  revalidatePath("/messages");
  revalidatePath(`/messages/${parsed.data.conversationId}`);
  return { sent: true };
}

export async function markMessagesRead(formData: FormData): Promise<void> {
  const parsed = markConversationReadSchema.safeParse({
    conversationId: formData.get("conversationId"),
  });
  if (!parsed.success) return;

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) return;

  await markConversationRead(parsed.data.conversationId, auth.user.id);
  revalidatePath("/messages");
}
