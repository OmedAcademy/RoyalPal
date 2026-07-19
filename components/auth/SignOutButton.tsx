"use client";

import { useTransition } from "react";
import { logout } from "@/lib/actions/auth";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => logout())}
      className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-60 dark:border-white/20"
    >
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
