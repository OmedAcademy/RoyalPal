"use client";

import { useActionState, useState } from "react";
import {
  requestAccountDeletion,
  cancelAccountDeletion,
  type AccountActionState,
} from "@/lib/actions/account";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/field-styles";

export function DeleteAccountPanel({
  graceDays,
  scheduledFor,
}: {
  graceDays: number;
  scheduledFor: string | null;
}) {
  const [requestState, requestAction, requesting] = useActionState(requestAccountDeletion, {});
  const [cancelState, cancelAction, cancelling] = useActionState<AccountActionState, FormData>(
    cancelAccountDeletion,
    {},
  );
  const [expanded, setExpanded] = useState(false);

  const pending = scheduledFor && !cancelState.message;

  if (pending) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
        <h2 className="text-base font-semibold text-amber-900 dark:text-amber-300">
          Deletion scheduled
        </h2>
        <p className="text-sm text-amber-900 dark:text-amber-300">
          Your account and personal details will be removed on {scheduledFor}. If you didn&apos;t
          ask for this, cancel it now and change your password.
        </p>
        <form action={cancelAction}>
          <Button type="submit" variant="secondary" disabled={cancelling} aria-busy={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel deletion"}
          </Button>
        </form>
        {cancelState.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {cancelState.error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="border-hairline flex flex-col gap-3 rounded-2xl border p-4">
      <h2 className="text-base font-semibold">Delete your account</h2>

      {requestState.message ? (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {requestState.message}
        </p>
      ) : (
        <>
          <p className="text-muted text-sm leading-relaxed">
            We remove your name, photo, contact details and profile. We keep the record that a
            lesson happened, what was paid, and messages you exchanged — a lesson has two people in
            it, and erasing one would erase the other&apos;s record of their own lesson.
          </p>
          <p className="text-muted text-sm">
            Deletion happens {graceDays} days after you ask, so it can be undone if someone else
            requested it.
          </p>

          {!expanded ? (
            <Button variant="secondary" onClick={() => setExpanded(true)} className="self-start">
              Delete my account
            </Button>
          ) : (
            <form action={requestAction} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="deletion-reason" className="text-sm font-medium">
                  Anything you&apos;d like us to know?{" "}
                  <span className="text-muted">(optional)</span>
                </label>
                <textarea
                  id="deletion-reason"
                  name="reason"
                  rows={2}
                  maxLength={1000}
                  className={`${fieldInputClass} resize-y`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="deletion-confirm" className="text-sm font-medium">
                  Type DELETE to confirm
                </label>
                <input
                  id="deletion-confirm"
                  name="confirm"
                  type="text"
                  required
                  autoComplete="off"
                  className={fieldInputClass}
                />
              </div>
              {requestState.error && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {requestState.error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={requesting} aria-busy={requesting}>
                  {requesting ? "Scheduling…" : `Schedule deletion in ${graceDays} days`}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setExpanded(false)}>
                  Keep my account
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
