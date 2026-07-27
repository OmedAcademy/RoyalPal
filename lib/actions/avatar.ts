"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";

export type AvatarActionState = {
  error?: string;
  message?: string;
  avatarUrl?: string;
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export async function uploadAvatar(
  _prevState: AvatarActionState,
  formData: FormData,
): Promise<AvatarActionState> {
  const file = formData.get("avatar");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload" };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { error: "Image must be smaller than 5MB" };
  }
  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    return { error: "Image must be a JPEG, PNG, or WebP file" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const user = auth.user;

  const path = `${user.id}/avatar.${extensionFor(file.type)}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);

  // Cache-bust: the storage path is stable across re-uploads, so without a
  // query param the browser (and any CDN) would keep serving the old image.
  const avatarUrl = `${publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath("/student/profile");
  revalidatePath("/tutor/profile");
  revalidatePath("/student/dashboard");
  revalidatePath("/tutor/dashboard");

  return { message: "Photo updated", avatarUrl };
}
