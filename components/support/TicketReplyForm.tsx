"use client";

import { useActionState, useEffect, useRef } from "react";
import { replyToTicket, type SupportActionState } from "@/lib/actions/support";
import { Button } from "@/components/ui/Button";

const initialState: SupportActionState = {};

export function TicketReplyForm({ ticketId }: { ticketId: string }) {
  const [state, formAction, pending] = useActionState(replyToTicket, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.message) formRef.current?.reset();
  }, [state.message]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <label htmlFor="reply-body" className="sr-only">
        Write a reply
      </label>
      <textarea
        id="reply-body"
        name="body"
        rows={4}
        required
        maxLength={5000}
        placeholder="Add anything else that might help…"
        className="border-hairline-strong bg-surface focus:border-royal w-full resize-y rounded-xl border px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[color:var(--ring)] focus:outline-none"
      />

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.message}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Sending…" : "Reply"}
        </Button>
      </div>
    </form>
  );
}
