-- Base table-level privileges for anon/authenticated/service_role.
--
-- RLS policies (0002-0010) control which ROWS a role can see or touch, but
-- Postgres also requires a base GRANT before a role can attempt the
-- operation at all — RLS alone is not sufficient. This was missed in the
-- original migrations and caught by a live connectivity test: anon got a
-- flat "permission denied for table subjects" from Postgres itself, not an
-- RLS-filtered empty result.
--
-- Grants here are scoped per-role to match what each role's RLS policies
-- actually allow, as a defense-in-depth measure — even if a future RLS
-- policy is written too permissively, the role still can't exceed what's
-- granted here.

grant usage on schema public to anon, authenticated;

-- anon: public read-only surface (unauthenticated visitors browsing tutors).
grant select on public.subjects to anon;
grant select on public.tutor_subjects to anon;
grant select on public.tutor_profiles to anon;
grant select on public.availability_rules to anon;
grant select on public.availability_exceptions to anon;
grant select on public.reviews to anon;

-- authenticated: every table RLS allows some access to, matching the
-- operations each table's policies actually support (e.g. payments is
-- select-only for clients; bookings/admin_actions have no delete policy).
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.student_profiles to authenticated;
grant select, insert, update on public.tutor_profiles to authenticated;
grant select, insert, update, delete on public.subjects to authenticated;
grant select, insert, update, delete on public.tutor_subjects to authenticated;
grant select, insert, update, delete on public.availability_rules to authenticated;
grant select, insert, update, delete on public.availability_exceptions to authenticated;
grant select, insert, update on public.bookings to authenticated;
grant select on public.payments to authenticated;
grant select, insert on public.reviews to authenticated;
grant select, insert, update, delete on public.favorites to authenticated;
grant select, insert, update, delete on public.admin_actions to authenticated;

-- Sequence access for serial columns (subjects.id), needed alongside the
-- insert grant above.
grant usage, select on all sequences in schema public to authenticated;

-- service_role bypasses RLS but should not be assumed to already have
-- table grants on this project — make it explicit rather than relying on
-- platform defaults we just proved wrong for anon/authenticated.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
