-- Two moderation controls that the database does not currently enforce.
--
-- =========================================================================
-- 1. SUSPENSION IS NOT ENFORCED AT THE DATABASE LAYER
-- =========================================================================
-- Suspension is checked in middleware, requireProfile, requireApiUser and
-- activeUserOrError — every one of which is application code. No RLS policy
-- looks at profiles.status, and setUserStatus (lib/actions/admin.ts) writes
-- the column without revoking the session.
--
-- A suspended account therefore keeps a valid JWT and the anon key is public
-- by design, so PostgREST remains open to it. Proven against real Postgres,
-- as a suspended user, with every migration applied:
--
--   send a message ........ ALLOWED (rows=1)
--   leave a review ........ ALLOWED (rows=1)
--   save a favourite ...... ALLOWED (rows=1)
--   open a support ticket . ALLOWED (rows=1)
--   edit their own profile  ALLOWED (rows=1)
--
-- The first of those is the one that matters. Suspension is the tool for
-- stopping someone harassing another user; today that person can keep
-- messaging their victim by talking to /rest/v1/messages directly, and the
-- product's own moderation control does not stop them.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- It does not touch support_tickets or support_messages. A suspended user
-- being able to open and reply to a ticket is DELIBERATE — it is the appeal
-- route, middleware allows /support for exactly this reason
-- (SUSPENDED_ALLOWED_PREFIXES), and both API routes pass allowSuspended.
-- Blocking it would leave a suspended person with our own error messages
-- telling them to contact a support system that refuses them.
--
-- It also leaves reads alone. A suspended user may still see their own
-- bookings, lessons and history; suspension removes the ability to ACT, not
-- the ability to see what happened.
--
-- This is defence in depth, not the whole fix. Revoking the session on
-- suspend still belongs in the application, and is recorded separately.

create or replace function public.is_active()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

comment on function public.is_active() is
  'True when the calling user''s account is active. Mirrors is_admin(): security definer so a policy can read profiles without recursing, and stable so it is evaluated once per statement.';

-- messages ---------------------------------------------------------------
-- Recreated with the same participation and open-conversation conditions as
-- migration 0032; the only addition is is_active().
drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant"
  on public.messages for insert
  with check (
    auth.uid() = sender_id
    and public.is_active()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.status = 'open'
        and (c.student_id = auth.uid() or c.tutor_id = auth.uid())
    )
  );

-- reviews ----------------------------------------------------------------
-- Same conditions as migration 0029 plus is_active(). A suspended student
-- must not be able to leave a review on the way out.
drop policy if exists "reviews_insert_own_completed_paid_booking" on public.reviews;
create policy "reviews_insert_own_completed_paid_booking"
  on public.reviews for insert
  with check (
    auth.uid() = student_id
    and public.is_active()
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.student_id = auth.uid()
        and b.status = 'completed'
    )
    and exists (
      select 1 from public.payments p
      where p.booking_id = reviews.booking_id
        and p.status = 'succeeded'
    )
  );

-- favorites --------------------------------------------------------------
-- WITH CHECK gains is_active(), USING does not: a suspended user cannot add
-- a saved tutor, but can still remove one. Removing is the harmless
-- direction and there is no reason to trap someone's own list.
drop policy if exists "favorites_manage_own_or_admin" on public.favorites;
create policy "favorites_manage_own_or_admin"
  on public.favorites for all
  using (auth.uid() = student_id or public.is_admin())
  with check ((auth.uid() = student_id and public.is_active()) or public.is_admin());

-- =========================================================================
-- 2. support_messages.from_admin IS CLIENT-SUPPLIED
-- =========================================================================
-- 0031's insert policy constrains sender_id and ticket participation but says
-- nothing about from_admin, and the column is granted to `authenticated` with
-- the rest of the table. Both renderers key the label off that column alone
-- (lib/support/service.ts), so a user could insert into their OWN ticket with
-- from_admin = true and produce a message that reads "RoyalPal Support" to
-- themselves and to the admin reviewing the thread.
--
-- The Server Action hard-codes from_admin: false and its comment calls that
-- the defence. It is not — the action is not the boundary, PostgREST is.
-- This pins the column to what the database itself knows about the caller,
-- which is the same shape of fix as deriving sender_id from auth.uid().
drop policy if exists "support_messages_insert_participant_or_admin" on public.support_messages;
create policy "support_messages_insert_participant_or_admin"
  on public.support_messages for insert
  with check (
    auth.uid() = sender_id
    and from_admin = public.is_admin()
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
