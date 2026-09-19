-- Booking-scoped messaging between a student and the tutor they booked.
--
-- WHY BOOKING-SCOPED, AND NOT AN OPEN INBOX
-- An open inbox on a tutoring marketplace is an unsolicited-contact channel
-- between adults and, in all likelihood, minors. Anchoring every conversation
-- to a booking means a message can only ever travel along a relationship the
-- student themselves created, there is no stranger-to-stranger surface, and
-- every thread has an owner, a start, and an end. That is a safeguarding
-- decision before it is a product one. Widening it later is a deliberate act
-- with its own review; starting wide cannot be undone.
--
-- SAFEGUARDING NOTE, WHICH THE PRIVACY POLICY MUST STATE
-- Admins can read every message (the policy below). This is required to
-- investigate an abuse or safeguarding report at all — a report about a
-- message nobody may read cannot be actioned. Messages are also immutable:
-- no UPDATE or DELETE policy exists for anyone, because a thread that can be
-- edited afterwards is not evidence. Both facts are user-visible and must
-- appear in the privacy policy and acceptable-use terms.
-- >>> REQUIRES LEGAL REVIEW <<<

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- One conversation per booking, enforced by the unique constraint rather
  -- than by application care.
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  -- 'open' accepts messages; 'closed' is read-only. Closing is how a thread
  -- ends without destroying it: the record survives for reports and disputes.
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_reason text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  constraint conversations_distinct_parties check (student_id <> tutor_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index conversations_student_idx
  on public.conversations (student_id, last_message_at desc nulls last);
create index conversations_tutor_idx
  on public.conversations (tutor_id, last_message_at desc nulls last);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- Unread badge, per recipient. Partial: unread is the small set, and this is
-- the query every layout runs on every page load.
create index messages_unread_idx
  on public.messages (conversation_id, sender_id)
  where read_at is null;

create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger touch_conversation_after_message
  after insert on public.messages
  for each row execute function public.touch_conversation();

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "conversations_select_participant_or_admin"
  on public.conversations for select
  using (auth.uid() = student_id or auth.uid() = tutor_id or public.is_admin());

-- No client INSERT: a conversation is created by the server when the booking
-- that justifies it is created. A client that could insert one could invent
-- the relationship the whole design depends on.
create policy "conversations_update_admin"
  on public.conversations for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "messages_select_participant_or_admin"
  on public.messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.student_id = auth.uid() or c.tutor_id = auth.uid())
    )
  );

-- Three conditions, each load-bearing: you are the sender named on the row,
-- you are a party to the conversation, and the conversation is still open.
create policy "messages_insert_participant"
  on public.messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.status = 'open'
        and (c.student_id = auth.uid() or c.tutor_id = auth.uid())
    )
  );

-- Marking read is the only permitted update, and only by the RECIPIENT:
-- sender_id <> auth.uid() in the USING clause means nobody can mark their own
-- message as read on the other party's behalf. The column lock below stops
-- this policy from being used to rewrite the message body.
create policy "messages_update_read_by_recipient"
  on public.messages for update
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.student_id = auth.uid() or c.tutor_id = auth.uid())
    )
  )
  with check (sender_id <> auth.uid());

-- RLS cannot scope columns, so without this a recipient could use the
-- mark-as-read policy above to rewrite what the other person said. Same
-- reasoning, and same shape, as the booking column lock in 0029.
create or replace function public.protect_message_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'only read_at can be changed on a message'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_message_columns
  before update on public.messages
  for each row execute function public.protect_message_columns();

grant select on public.conversations to authenticated;
grant update on public.conversations to authenticated; -- gated to admins by RLS
grant select, insert, update on public.messages to authenticated;
grant all on public.conversations to service_role;
grant all on public.messages to service_role;
