-- The audit log must not be deletable by the people it audits.
--
-- 0011 granted `select, insert, update, delete on admin_actions to
-- authenticated`, and 0010's policy is `for all using is_admin()`. Together
-- those mean any admin can delete the record of their own privileged actions.
-- Proven against real Postgres: an admin ran `delete from public.admin_actions`
-- and it returned rows=1.
--
-- That matters because admins can change any user's role and status directly
-- through PostgREST (0027 permits it for is_admin()), issue refunds, and hide
-- reviews. The audit log exists precisely for the insider case, and an insider
-- could erase it.
--
-- Every write to this table already goes through the service role —
-- logAction() in lib/actions/admin.ts uses createAdminClient() — so removing
-- insert, update and delete from `authenticated` takes away nothing the
-- application uses. SELECT stays: the admin console reads the log.
--
-- Append-only is enforced by the absence of the privilege rather than by a
-- trigger, because a privilege cannot be talked around by a future policy edit.

revoke insert, update, delete on public.admin_actions from authenticated;
revoke insert, update, delete on public.admin_actions from anon;

-- Stated explicitly so the intent survives the next person reading the grants.
grant select on public.admin_actions to authenticated;
grant all on public.admin_actions to service_role;
