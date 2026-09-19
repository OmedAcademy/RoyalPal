-- Support tickets: the mechanism behind every "contact support" line the
-- product already prints (the suspension page, the tutor-rejection email,
-- every error that ends in "contact support"). Until now those were dead
-- ends — there was nothing on the other side of them.
--
-- Two tables rather than one: a ticket is a thread, and a thread that cannot
-- hold a reply is a form submission, not support. `support_messages` carries
-- both sides, so an admin's answer and the user's follow-up live in the same
-- ordered record and the audit trail is the conversation itself.
--
-- Deliberately NOT anonymous. A logged-out contact form is a spam magnet and
-- an unauthenticated write path into the database; the public /contact route
-- posts through a server action that rate-limits and emails the support
-- inbox WITHOUT touching this table. Everything here belongs to a real
-- account, which is what makes the RLS below expressible at all.

create type public.support_category as enum (
  'account',
  'booking',
  'payment',
  'technical',
  'report_user',
  'safeguarding',
  'other'
);

-- 'waiting_on_user' exists so an admin can stop the clock on a ticket that is
-- blocked on a reply, rather than leaving it indistinguishable from one
-- nobody has looked at. That distinction is the whole point of a queue.
create type public.support_status as enum (
  'open',
  'in_progress',
  'waiting_on_user',
  'resolved',
  'closed'
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category public.support_category not null default 'other',
  subject text not null check (length(trim(subject)) between 1 and 200),
  status public.support_status not null default 'open',
  -- Set when an admin picks the ticket up. Nullable: an unassigned ticket is
  -- a real and important state, not a data-quality problem.
  assigned_admin_id uuid references public.profiles (id) on delete set null,
  -- Denormalised from support_messages so the queue can sort by activity
  -- without a correlated subquery per row.
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  -- Recorded at write time rather than derived from the sender's CURRENT role:
  -- an admin who is later demoted must not retroactively turn their past
  -- replies into user messages, and vice versa.
  from_admin boolean not null default false,
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- The admin queue: everything not yet finished, oldest activity first. A
-- partial index because the resolved/closed set grows without bound and is
-- never what the queue is asking for.
create index support_tickets_queue_idx
  on public.support_tickets (last_message_at)
  where status in ('open', 'in_progress', 'waiting_on_user');

create trigger set_support_tickets_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

-- Keeps last_message_at honest without the application having to remember.
create or replace function public.touch_support_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_tickets
     set last_message_at = new.created_at
   where id = new.ticket_id;
  return new;
end;
$$;

create trigger touch_support_ticket_after_message
  after insert on public.support_messages
  for each row execute function public.touch_support_ticket();

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

create policy "support_tickets_select_own_or_admin"
  on public.support_tickets for select
  using (auth.uid() = user_id or public.is_admin());

create policy "support_tickets_insert_own"
  on public.support_tickets for insert
  with check (auth.uid() = user_id);

-- Only admins may UPDATE. A user changing their own ticket's status would let
-- them mark their own complaint resolved, or reassign it — neither is theirs
-- to do. Users participate by adding a message, which is the insert below.
create policy "support_tickets_update_admin"
  on public.support_tickets for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "support_messages_select_participant_or_admin"
  on public.support_messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.support_tickets t
      where t.id = support_messages.ticket_id and t.user_id = auth.uid()
    )
  );

-- A message must be sent BY the sender (no writing in someone else's name)
-- and INTO a ticket they are party to. A closed ticket takes no new messages:
-- reopening is an admin action, so "closed" means closed rather than merely
-- labelled.
create policy "support_messages_insert_participant_or_admin"
  on public.support_messages for insert
  with check (
    auth.uid() = sender_id
    and (
      public.is_admin()
      or exists (
        select 1 from public.support_tickets t
        where t.id = support_messages.ticket_id
          and t.user_id = auth.uid()
          and t.status <> 'closed'
      )
    )
  );

-- No UPDATE or DELETE policy on messages, for either side: a support thread
-- that can be edited after the fact is not evidence, and safeguarding reports
-- (support_category 'safeguarding'/'report_user') are exactly the case where
-- it needs to be.

grant select, insert on public.support_tickets to authenticated;
grant update on public.support_tickets to authenticated; -- gated to admins by RLS above
grant select, insert on public.support_messages to authenticated;
grant all on public.support_tickets to service_role;
grant all on public.support_messages to service_role;
