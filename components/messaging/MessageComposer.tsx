"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendMessage, type MessagingActionState } from "@/lib/actions/messaging";
import { Button } from "@/components/ui/Button";

const initialState: MessagingActionState = {};

export function MessageComposer({ conversationId }: { conversationId: string }) {
  const [state, formAction, pending] = useActionState(sendMessage, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Clear only on a confirmed send. Resetting optimistically would throw away
  // what someone typed if the send was refused, which is the worst possible
  // moment to lose it.
  useEffect(() => {
    if (state.sent) {
      formRef.current?.reset();
      inputRef.current?.focus();
    }
  }, [state.sent]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <label htmlFor="message-body" className="sr-only">
        Write a message
      </label>
      <textarea
        ref={inputRef}
        id="message-body"
        name="body"
        rows={3}
        required
        maxLength={4000}
        placeholder="Write a message…"
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

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
