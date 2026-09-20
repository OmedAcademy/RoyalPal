-- SUP-2: a client chooses only the three columns that are its to choose.
--
-- `support_tickets_insert_own` pins `user_id` and nothing else, and 0031
-- grants INSERT on the whole table. So the row a client supplies may also
-- carry `status`, `assigned_admin_id` and `last_message_at` — and the defaults
-- that were meant to be the truth are only a fallback for a client that
-- happens not to mention them.
--
-- What that buys an attacker is specific. A safeguarding ticket created
-- already `resolved` never appears in the urgent lift on the admin queue,
-- which filters `resolved` and `closed` out. One dated 2999 sorts off the end
-- of a queue ordered by oldest activity first. Either way the report exists,
-- looks fine in the database, and is never read by a person.
--
-- The same shape applies to `support_messages`: a client-supplied `created_at`
-- reorders a support thread, and the thread IS the record of what was said and
-- when.
--
-- COLUMN GRANTS, NOT A FATTER POLICY PREDICATE
-- Same reasoning as 0041. `last_message_at` cannot be pinned in a policy
-- without inventing a clock-skew window, whereas withholding the privilege
-- says exactly the intended thing: this column is not the client's to supply,
-- so the DEFAULT stands. It also fails closed as the schema grows — a column
-- added to support_tickets tomorrow is not insertable until someone grants it,
-- which is the failure mode 0041 was written to stop repeating.
--
-- A table-level grant implies the column privilege and cannot be narrowed by
-- revoking a subset, so the table-level INSERT has to go first.

revoke insert on public.support_tickets from authenticated;
revoke insert on public.support_tickets from anon;

-- Exactly what createTicket() sends. status, assigned_admin_id and
-- last_message_at now take their defaults; an admin changes them through the
-- service role, as they already did.
grant insert (user_id, category, subject) on public.support_tickets to authenticated;

revoke insert on public.support_messages from authenticated;
revoke insert on public.support_messages from anon;

-- from_admin stays insertable because 0042's policy requires it to EQUAL
-- public.is_admin() — the client must supply it and must supply the truth.
-- `id` and `created_at` are withheld: both have defaults, and neither is a
-- claim a participant gets to make about their own message.
grant insert (ticket_id, sender_id, from_admin, body) on public.support_messages to authenticated;
