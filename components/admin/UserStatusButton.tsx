"use client";

import { useActionState } from "react";
import { setUserStatus, type AdminActionState } from "@/lib/actions/admin";

const initial: AdminActionState = {};

/** Suspend or reactivate a user account. */
export function UserStatusButton({ userId, status }: { userId: string; status: string }) {
  const [state, action, pending] = useActionState(setUserStatus, initial);
  const next = status === "suspended" ? "active" : "suspended";
  const isSuspend = next === "suspended";

  return (
    <form action={action} className="inline">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="status" value={next} />
      <button
        type="submit"
        disabled={pending}
        className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
          isSuspend
            ? "border-red-300 text-red-700 hover:bg-red-50"
            : "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
        }`}
        title={state.error ?? undefined}
      >
        {pending ? "…" : isSuspend ? "Suspend" : "Reactivate"}
      </button>
    </form>
  );
}
