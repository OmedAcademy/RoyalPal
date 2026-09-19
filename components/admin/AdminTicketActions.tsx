"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  adminReplyToTicket,
  updateTicketStatus,
  type SupportActionState,
} from "@/lib/actions/support";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/field-styles";
import type { SupportStatus } from "@/types/database";

const initialState: SupportActionState = {};

const STATUSES: { value: SupportStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_on_user", label: "Waiting on user" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export function AdminTicketActions({
  ticketId,
  currentStatus,
}: {
  ticketId: string;
  currentStatus: SupportStatus;
}) {
  const [replyState, replyAction, replying] = useActionState(adminReplyToTicket, initialState);
  const [statusState, statusAction, updating] = useActionState(updateTicketStatus, initialState);
  const replyRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (replyState.message) replyRef.current?.reset();
  }, [replyState.message]);

  return (
    <div className="flex flex-col gap-5">
      <form ref={replyRef} action={replyAction} className="flex flex-col gap-2">
        <input type="hidden" name="ticketId" value={ticketId} />
        <label htmlFor="admin-reply" className="text-sm font-medium">
          Reply to the requester
        </label>
        <textarea
          id="admin-reply"
          name="body"
          rows={5}
          required
          maxLength={5000}
          className={`${fieldInputClass} resize-y`}
          placeholder="Replying moves this ticket to “waiting on user”."
        />
        {replyState.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {replyState.error}
          </p>
        )}
        {replyState.message && (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {replyState.message}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={replying} aria-busy={replying}>
            {replying ? "Sending…" : "Send reply"}
          </Button>
        </div>
      </form>

      <form
        action={statusAction}
        className="border-hairline flex flex-wrap items-end gap-2 border-t pt-4"
      >
        <input type="hidden" name="ticketId" value={ticketId} />
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <label htmlFor="ticket-status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="ticket-status"
            name="status"
            defaultValue={currentStatus}
            className={fieldInputClass}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary" disabled={updating} aria-busy={updating}>
          {updating ? "Saving…" : "Update status"}
        </Button>
        {statusState.error && (
          <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
            {statusState.error}
          </p>
        )}
        {statusState.message && (
          <p role="status" className="w-full text-sm text-green-700 dark:text-green-400">
            {statusState.message}
          </p>
        )}
      </form>
    </div>
  );
}
