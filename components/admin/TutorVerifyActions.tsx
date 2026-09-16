"use client";

import { useActionState } from "react";
import { setTutorVerification, type AdminActionState } from "@/lib/actions/admin";
import type { TutorVerificationStatus } from "@/types/database";

const initial: AdminActionState = {};

function ActionButton({
  tutorId,
  status,
  label,
  tone,
}: {
  tutorId: string;
  status: "approved" | "rejected" | "pending";
  label: string;
  tone: "approve" | "reject" | "neutral";
}) {
  const [state, action, pending] = useActionState(setTutorVerification, initial);
  const toneClass =
    tone === "approve"
      ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
      : tone === "reject"
        ? "border-red-300 text-red-700 hover:bg-red-50"
        : "border-hairline text-muted hover:bg-[color:var(--hairline)]";

  return (
    <form action={action} className="inline">
      <input type="hidden" name="tutorId" value={tutorId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        disabled={pending}
        className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${toneClass}`}
        title={state.error ?? undefined}
      >
        {pending ? "…" : label}
      </button>
    </form>
  );
}

/** Contextual verification controls based on the tutor's current status. */
export function TutorVerifyActions({
  tutorId,
  status,
}: {
  tutorId: string;
  status: TutorVerificationStatus;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {status !== "approved" && (
        <ActionButton tutorId={tutorId} status="approved" label="Approve" tone="approve" />
      )}
      {status !== "rejected" && (
        <ActionButton tutorId={tutorId} status="rejected" label="Reject" tone="reject" />
      )}
      {status !== "pending" && (
        <ActionButton tutorId={tutorId} status="pending" label="Reset" tone="neutral" />
      )}
    </div>
  );
}
