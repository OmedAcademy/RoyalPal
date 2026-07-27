-- M-Reviews: public review lists need the reviewer's display name and
-- avatar, but profiles RLS (rightly) hides students' rows from other
-- students — and adding a broad "reviewers are readable" policy would
-- expose the ENTIRE row, including phone. RLS can't scope columns, so this
-- definer-rights view projects exactly the three safe columns instead:
-- the view's owner (postgres) owns profiles too, and table owners bypass
-- RLS unless FORCE ROW LEVEL SECURITY is set, which it isn't.
create view public.review_authors
with (security_invoker = off) as
select p.id, p.full_name, p.avatar_url
from public.profiles p
where exists (select 1 from public.reviews r where r.student_id = p.id);

-- Review lists render on pages that already require login; anon gets
-- nothing.
grant select on public.review_authors to authenticated;
