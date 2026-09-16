"use client";

import { useActionState, useState } from "react";
import { uploadAvatar, type AvatarActionState } from "@/lib/actions/avatar";

const initialState: AvatarActionState = {};

export function AvatarUpload({
  currentAvatarUrl,
  fullName,
}: {
  currentAvatarUrl: string | null;
  fullName: string;
}) {
  const [state, formAction, pending] = useActionState(uploadAvatar, initialState);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const displayUrl = previewUrl ?? state.avatarUrl ?? currentAvatarUrl;
  const initial = fullName.trim().charAt(0).toUpperCase() || "?";

  return (
    <form action={formAction} className="flex items-center gap-4">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        {displayUrl ? (
          // avatar URL is a Supabase Storage public URL, not a static asset next/image can optimize.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayUrl} alt={fullName} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-500">
            {initial}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">
          Profile photo
          <input
            type="file"
            name="avatar"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setPreviewUrl(file ? URL.createObjectURL(file) : null);
            }}
            className="mt-1 block text-sm"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-60 dark:border-white/20"
          >
            {pending ? "Uploading..." : "Upload photo"}
          </button>
          {state.message && (
            <span className="text-sm text-green-700 dark:text-green-400">{state.message}</span>
          )}
          {state.error && (
            <span role="alert" className="text-sm text-red-600 dark:text-red-400">
              {state.error}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">JPEG, PNG, or WebP. Max 5MB.</p>
      </div>
    </form>
  );
}
