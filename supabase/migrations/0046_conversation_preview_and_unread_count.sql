-- MSG-3 and MSG-4: two inbox numbers that were wrong in the same place.
--
-- MSG-3 — THE PREVIEW
-- lastMessagePreviews() asked for the messages of every listed thread in one
-- query, ordered oldest-first, capped at 1000, and let the last row per
-- conversation win the map. Past about a thousand messages across the listed
-- threads the cap bites, and it bites from the WRONG END: the threads with the
-- most recent activity — the ones at the top of the inbox — get no preview at
-- all, while quiet old threads show text from months ago. The inbox is
-- least accurate exactly where a person is looking.
--
-- Denormalised onto the conversation, maintained by the trigger that already
-- maintains last_message_at, for the reason 0032 gives for that column: so the
-- list can be rendered without a correlated subquery per row. One column
-- removes the query entirely rather than making it bigger.
--
-- MSG-4 — THE UNREAD BADGE
-- unreadMessageCount() counted messages with no participant predicate at all
-- and leaned on RLS for scope. For a student or a tutor that happens to be
-- right. For an ADMIN, whose select policy is every message on the platform,
-- the badge in the navigation counted every unread message between every
-- other pair of people on RoyalPal.
--
-- Expressed as a function so the join that makes it correct is written once,
-- in SQL, next to the indexes that make it cheap. SECURITY INVOKER: RLS still
-- applies underneath, so this narrows the answer and can never widen it.

alter table public.conversations add column last_message_preview text;

create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         -- 140 characters is what every client truncates to anyway. Storing
         -- the truncation rather than the body keeps this column a display
         -- affordance and not a second copy of the conversation.
         last_message_preview = left(new.body, 140)
   where id = new.conversation_id;
  return new;
end;
$$;

-- Backfill, so the column is right for threads that already exist rather than
-- only for the next message sent in them.
update public.conversations c
   set last_message_preview = newest.body
  from (
    select distinct on (conversation_id)
           conversation_id,
           left(body, 140) as body
      from public.messages
     order by conversation_id, created_at desc
  ) newest
 where newest.conversation_id = c.id;

-- The preview and the activity timestamp are the trigger's to write, not a
-- client's. `grant update on conversations to authenticated` was table-level
-- and gated to admins by RLS — which means an admin could rewrite either one
-- and make the inbox say something that never happened. Closing a thread is
-- the only update a person legitimately makes here.
revoke update on public.conversations from authenticated;
grant update (status, closed_reason) on public.conversations to authenticated;

create or replace function public.unread_message_count()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::int
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.read_at is null
     and m.sender_id <> auth.uid()
     and (c.student_id = auth.uid() or c.tutor_id = auth.uid());
$$;

-- Granted to authenticated on purpose: this is the badge every signed-in page
-- renders, it takes no arguments, and it can only ever count the caller's own
-- unread messages. Revoked from public first — the 0040 lesson, where
-- revoking from authenticated alone left PUBLIC's default grant untouched.
revoke execute on function public.unread_message_count() from public;
revoke execute on function public.unread_message_count() from anon;
grant execute on function public.unread_message_count() to authenticated;
grant execute on function public.unread_message_count() to service_role;
