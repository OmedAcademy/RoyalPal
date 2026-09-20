"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NotificationService } from "@/lib/notifications/service";
import { refundBookingPayment } from "@/lib/stripe/refunds";
import { isStripeConfigured } from "@/lib/stripe/client";
import { sendSelfTest, type ProbeResult } from "@/lib/notifications/diagnostics";
import { optionalText } from "@/lib/validations/shared";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "admin-action" });

export type AdminActionState = { error?: string; message?: string };

/**
 * Confirms the caller is an admin using their RLS-scoped session (never
 * trusting a form field), then returns the service-role client for the
 * privileged write plus the acting admin's id for the audit trail. Every
 * admin mutation funnels through here so the authorization check can't be
 * forgotten.
 */
async function authorizeAdmin(): Promise<
  { ok: true; adminId: string } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") return { ok: false, error: "Admins only" };
  return { ok: true, adminId: user.id };
}

async function logAction(
  adminId: string,
  action: string,
  targetId: string,
  notes?: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("admin_actions").insert({
    admin_id: adminId,
    action,
    target_id: targetId,
    notes: notes ?? null,
  });
}

const REJECTION_REASONS = [
  "Profile is incomplete",
  "Bio or headline needs more detail",
  "Qualifications could not be verified",
  "Photo does not meet our guidelines",
  "Pricing looks incorrect",
  "Something else",
] as const;

export const TUTOR_REJECTION_REASONS = REJECTION_REASONS;

const verificationSchema = z
  .object({
    tutorId: z.string().uuid(),
    status: z.enum(["approved", "rejected", "pending"]),
    reason: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    // A rejection with no reason is what produced the old "please review and
    // update your profile" message, sent to someone with no way of knowing
    // what was wrong. That is a support ticket by construction.
    if (data.status === "rejected" && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Choose a reason so the tutor knows what to change",
      });
    }
  });

export async function setTutorVerification(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await authorizeAdmin();
  if (!auth.ok) return { error: auth.error };

  const parsed = verificationSchema.safeParse({
    tutorId: formData.get("tutorId"),
    status: formData.get("status"),
    reason: formData.get("reason") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("tutor_profiles")
    .update({
      verification_status: parsed.data.status,
      // Cleared on approval: a stale rejection reason sitting on an approved
      // profile is worse than none, because it reads as current.
      rejection_reason: parsed.data.status === "rejected" ? (parsed.data.reason ?? null) : null,
      rejection_notes: parsed.data.status === "rejected" ? (parsed.data.notes ?? null) : null,
      verification_decided_at: new Date().toISOString(),
      verification_decided_by: auth.adminId,
    })
    .eq("id", parsed.data.tutorId);

  if (error) return { error: error.message };

  await logAction(auth.adminId, `tutor_verification:${parsed.data.status}`, parsed.data.tutorId);

  if (parsed.data.status === "approved") {
    await NotificationService.emit({
      userId: parsed.data.tutorId,
      type: "tutor_approved",
      title: "You're an approved RoyalPal tutor 🎓",
      body: "Students can now discover and book lessons with you.",
      data: { href: "/tutor/dashboard" },
    });
  } else if (parsed.data.status === "rejected") {
    await NotificationService.emit({
      userId: parsed.data.tutorId,
      type: "tutor_rejected",
      title: "Your tutor application needs changes",
      // The reason, not a generic instruction. The tutor's own dashboard shows
      // the same string, so the notification and the profile agree.
      body: parsed.data.notes
        ? `${parsed.data.reason}: ${parsed.data.notes}`
        : (parsed.data.reason ?? "Please review and update your profile."),
      data: { href: "/tutor/profile" },
    });
  }

  revalidatePath("/admin/tutors");
  revalidatePath("/admin");
  return { message: `Tutor ${parsed.data.status}.` };
}

const statusSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["active", "suspended"]),
});

export async function setUserStatus(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await authorizeAdmin();
  if (!auth.ok) return { error: auth.error };

  const parsed = statusSchema.safeParse({
    userId: formData.get("userId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  // Guard against an admin suspending themselves.
  if (parsed.data.userId === auth.adminId) {
    return { error: "You can't change your own account status." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.userId);

  if (error) return { error: error.message };

  // Writing the column is not enough. A suspended account keeps a valid,
  // refreshable JWT, and the anon key is public by design — so before
  // migration 0042 the suspended user could still write through PostgREST,
  // and even with 0042 blocking those writes their session would simply keep
  // working until it expired. Suspension has to end the session too.
  //
  // ban_duration is GoTrue's own mechanism and is what actually invalidates
  // the refresh token; setting it to "none" lifts the ban, which is why
  // reactivating has to clear it or a reversible moderation action becomes a
  // permanent lockout.
  //
  // Best-effort by design: the status column is the source of truth and is
  // already committed above. If GoTrue is unreachable we log loudly rather
  // than fail the whole action and leave an admin unsure whether the
  // suspension took.
  const banDuration = parsed.data.status === "suspended" ? "876000h" : "none";
  const { error: revokeError } = await admin.auth.admin.updateUserById(parsed.data.userId, {
    ban_duration: banDuration,
  });
  if (revokeError) {
    log.error("failed to update the account's auth ban", revokeError, {
      userId: parsed.data.userId,
      status: parsed.data.status,
    });
  }

  await logAction(auth.adminId, `user_status:${parsed.data.status}`, parsed.data.userId);
  revalidatePath("/admin/students");
  revalidatePath("/admin/tutors");
  revalidatePath("/admin/users");
  return { message: `User ${parsed.data.status}.` };
}

const refundSchema = z.object({
  bookingId: z.string().uuid(),
  notes: optionalText(500),
});

/**
 * Requests a full refund of a booking's payment. Deliberately does NOT
 * mark payments/bookings as refunded here — that write happens exclusively
 * in handleChargeRefunded (lib/stripe/webhook-handlers.ts) once Stripe
 * confirms the refund, mirroring how payment SUCCESS is only ever recorded
 * on webhook confirmation, never synchronously after a Stripe API call
 * returns. A successful stripe.refunds.create response means Stripe
 * accepted the request, not that money has actually moved yet.
 */
export async function refundBooking(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await authorizeAdmin();
  if (!auth.ok) return { error: auth.error };

  if (!isStripeConfigured()) {
    return { error: "Stripe is not configured on this deployment — refunds are unavailable." };
  }

  const parsed = refundSchema.safeParse({
    bookingId: formData.get("bookingId"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("status, stripe_payment_intent_id")
    .eq("booking_id", parsed.data.bookingId)
    .maybeSingle();

  if (!payment || !payment.stripe_payment_intent_id) {
    return { error: "No payment found for this booking" };
  }
  if (payment.status === "refunded") {
    return { error: "This payment has already been refunded" };
  }
  if (payment.status !== "succeeded") {
    return { error: "Only a succeeded payment can be refunded" };
  }

  try {
    await refundBookingPayment({ paymentIntentId: payment.stripe_payment_intent_id });
  } catch (err) {
    log.error("refund request failed", err, {
      bookingId: parsed.data.bookingId,
      adminId: auth.adminId,
    });
    return {
      error: `Stripe refund failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  await logAction(
    auth.adminId,
    "refund_initiated",
    parsed.data.bookingId,
    parsed.data.notes ?? undefined,
  );

  revalidatePath("/admin/payments");
  return { message: "Refund requested — it will show as refunded once Stripe confirms it." };
}

const hideSchema = z.object({
  reviewId: z.string().uuid(),
  reason: z.string().trim().min(1, "Give a reason").max(500),
});

/**
 * Hides a review.
 *
 * Hiding, never deleting. The row, its text, its author and its timestamp all
 * survive: a review that breaks the rules is also the evidence that it did,
 * and a complaint about a review nobody can read afterwards cannot be
 * reviewed. Migration 0035 enforces that hiding carries who and why, and its
 * column lock refuses any edit to the rating or comment — moderation removes a
 * review from view, it does not rewrite one.
 */
export async function hideReview(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await authorizeAdmin();
  if (!auth.ok) return { error: auth.error };

  const parsed = hideSchema.safeParse({
    reviewId: formData.get("reviewId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const admin = createAdminClient();
  const { data: review, error } = await admin
    .from("reviews")
    .update({
      hidden_at: new Date().toISOString(),
      hidden_by: auth.adminId,
      hidden_reason: parsed.data.reason,
    })
    .eq("id", parsed.data.reviewId)
    .select("tutor_id, student_id")
    .maybeSingle();

  if (error || !review) return { error: "Couldn't hide that review." };

  await logAction(auth.adminId, "review_hidden", parsed.data.reviewId);

  // The author is told, because being silently censored is worse than being
  // told why. The tutor is not: the usual reason for hiding is that the
  // exchange needs to stop.
  await NotificationService.emit({
    userId: review.student_id,
    type: "review_hidden",
    title: "One of your reviews was hidden",
    body: parsed.data.reason,
    data: { href: "/student/bookings" },
  });

  revalidatePath("/admin/reviews");
  revalidatePath(`/student/tutors/${review.tutor_id}`);
  return { message: "Review hidden." };
}

export async function unhideReview(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await authorizeAdmin();
  if (!auth.ok) return { error: auth.error };

  const reviewId = formData.get("reviewId");
  if (typeof reviewId !== "string") return { error: "Invalid request" };

  const admin = createAdminClient();
  // All three columns must clear together or 0035's CHECK refuses the row.
  const { data: review, error } = await admin
    .from("reviews")
    .update({ hidden_at: null, hidden_by: null, hidden_reason: null })
    .eq("id", reviewId)
    .select("tutor_id")
    .maybeSingle();

  if (error || !review) return { error: "Couldn't restore that review." };

  await logAction(auth.adminId, "review_restored", reviewId);

  revalidatePath("/admin/reviews");
  revalidatePath(`/student/tutors/${review.tutor_id}`);
  return { message: "Review restored." };
}

export type DeliveryTestState = AdminActionState & { results?: ProbeResult[] };

/**
 * Sends a test notification through every channel to the ACTING ADMIN, and
 * reports what each one said.
 *
 * The recipient is taken from the authorized session and cannot be named by
 * the caller. A "send a test to any user" control would be a spam primitive
 * with an admin badge on it, and there is no operational need for one: what an
 * operator has to know is whether the deployment can deliver at all, and their
 * own inbox answers that.
 *
 * Audited like every other privileged action, so a mailbox full of tests has a
 * name attached to it.
 */
export async function sendDeliveryTest(
  _prev: DeliveryTestState,
  _formData: FormData,
): Promise<DeliveryTestState> {
  const auth = await authorizeAdmin();
  if (!auth.ok) return { error: auth.error };

  const results = await sendSelfTest(auth.adminId);
  await logAction(auth.adminId, "delivery_test", auth.adminId);

  log.info("delivery test sent", {
    adminId: auth.adminId,
    failed: results.filter((result) => !result.ok).map((result) => result.channel),
  });

  revalidatePath("/admin/delivery");

  const failures = results.filter((result) => !result.ok).length;
  return {
    results,
    message: failures === 0 ? "All channels accepted the test." : undefined,
    error:
      failures > 0 ? `${failures} of ${results.length} channels could not deliver.` : undefined,
  };
}
