"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeUserOrError } from "@/lib/supabase/queries";
import { setPreference } from "@/lib/notifications/preferences";
import { registerPushToken, unregisterPushToken } from "@/lib/notifications/push";
import { NotificationService } from "@/lib/notifications/service";
import { DELETION_GRACE_DAYS } from "@/lib/account/anonymize";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "account-action" });

export type AccountActionState = {
  error?: string;
  message?: string;
};

const preferenceSchema = z.object({
  channel: z.enum(["email", "push"]),
  category: z.enum(["bookings", "messages", "reviews", "payments"]),
  enabled: z.union([z.literal("true"), z.literal("false")]).transform((v) => v === "true"),
});

export async function updateNotificationPreference(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const parsed = preferenceSchema.safeParse({
    channel: formData.get("channel"),
    category: formData.get("category"),
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) return { error: auth.error };

  await setPreference({
    userId: auth.user.id,
    channel: parsed.data.channel,
    category: parsed.data.category,
    enabled: parsed.data.enabled,
  });

  revalidatePath("/settings/notifications");
  return { message: "Saved." };
}

const deviceSchema = z.object({
  token: z.string().trim().min(10).max(500),
  platform: z.enum(["ios", "android", "web"]),
  deviceName: z.string().trim().max(120).optional(),
});

/**
 * Registers a device for push.
 *
 * Called by the mobile app after the OS grants notification permission. The
 * token is claimed rather than added — see registerPushToken for the shared-
 * device case that makes the difference matter.
 */
export async function registerDevice(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const parsed = deviceSchema.safeParse({
    token: formData.get("token"),
    platform: formData.get("platform"),
    deviceName: formData.get("deviceName") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid device registration" };

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) return { error: auth.error };

  try {
    await registerPushToken({
      userId: auth.user.id,
      token: parsed.data.token,
      platform: parsed.data.platform,
      deviceName: parsed.data.deviceName ?? null,
    });
  } catch {
    return { error: "Couldn't register this device for notifications." };
  }

  revalidatePath("/settings/notifications");
  return { message: "Notifications are on for this device." };
}

export async function removeDevice(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const token = formData.get("token");
  if (typeof token !== "string") return { error: "Invalid request" };

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) return { error: auth.error };

  // Scoped by user_id as well as token: the RLS delete policy already does
  // this, and matching it means a token belonging to someone else simply
  // matches nothing instead of being a refusal that confirms it exists.
  await supabase.from("push_tokens").delete().eq("user_id", auth.user.id).eq("token", token);

  revalidatePath("/settings/notifications");
  return { message: "This device won't receive notifications any more." };
}

/** Unregisters a token without needing a session — used on sign-out. */
export async function forgetDeviceToken(token: string): Promise<void> {
  if (!token) return;
  await unregisterPushToken(token);
}

const deletionSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  confirm: z.literal("DELETE", {
    message: "Type DELETE to confirm",
  }),
});

/**
 * Schedules account deletion.
 *
 * A grace period, not an immediate wipe, for a reason that is about safety
 * rather than second thoughts: an instant, irreversible delete sitting behind
 * a session is a weapon in an account takeover. Someone who gets into an
 * account could erase it before the owner notices. Scheduling it and emailing
 * the owner turns that into something recoverable.
 */
export async function requestAccountDeletion(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const parsed = deletionSchema.safeParse({
    reason: formData.get("reason") ?? undefined,
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) return { error: auth.error };

  const admin = createAdminClient();
  const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000);

  const { error } = await admin.from("account_deletion_requests").insert({
    user_id: auth.user.id,
    reason: parsed.data.reason ?? null,
    scheduled_for: scheduledFor.toISOString(),
  });

  if (error) {
    // The partial unique index allows only one live request per user, so a
    // duplicate is the user clicking twice, not a failure.
    if (error.code === "23505") {
      return { message: "Your account is already scheduled for deletion." };
    }
    log.error("failed to schedule account deletion", error, { userId: auth.user.id });
    return { error: "We couldn't schedule that. Please contact support." };
  }

  await admin
    .from("profiles")
    .update({ deletion_requested_at: new Date().toISOString() })
    .eq("id", auth.user.id);

  await NotificationService.emit({
    userId: auth.user.id,
    type: "account_deletion_requested",
    title: "Your RoyalPal account is scheduled for deletion",
    body: `It will be deleted in ${DELETION_GRACE_DAYS} days. If this wasn't you, cancel it now and change your password.`,
    data: { href: "/settings/account" },
  });

  revalidatePath("/settings/account");
  return {
    message: `Your account is scheduled for deletion in ${DELETION_GRACE_DAYS} days. You can cancel any time before then.`,
  };
}

export async function cancelAccountDeletion(
  _prevState: AccountActionState,
  _formData: FormData,
): Promise<AccountActionState> {
  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) return { error: auth.error };

  const admin = createAdminClient();
  const { data: cancelled } = await admin
    .from("account_deletion_requests")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("user_id", auth.user.id)
    .is("cancelled_at", null)
    .is("completed_at", null)
    .select("id");

  await admin.from("profiles").update({ deletion_requested_at: null }).eq("id", auth.user.id);

  if (cancelled && cancelled.length > 0) {
    await NotificationService.emit({
      userId: auth.user.id,
      type: "account_deletion_cancelled",
      title: "Account deletion cancelled",
      body: "Your RoyalPal account will not be deleted.",
      data: { href: "/settings/account" },
    });
  }

  revalidatePath("/settings/account");
  return { message: "Your account will not be deleted." };
}
