"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NotificationService } from "@/lib/notifications/service";

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

const verificationSchema = z.object({
  tutorId: z.string().uuid(),
  status: z.enum(["approved", "rejected", "pending"]),
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
  });
  if (!parsed.success) return { error: "Invalid request" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("tutor_profiles")
    .update({ verification_status: parsed.data.status })
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
      body: "Please review and update your profile, then it can be re-reviewed.",
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

  await logAction(auth.adminId, `user_status:${parsed.data.status}`, parsed.data.userId);
  revalidatePath("/admin/students");
  revalidatePath("/admin/tutors");
  revalidatePath("/admin/users");
  return { message: `User ${parsed.data.status}.` };
}
