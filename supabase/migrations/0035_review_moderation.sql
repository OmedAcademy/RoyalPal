-- Review moderation and tutor replies.
--
-- 0008 made reviews immutable and that was right: a review a tutor can edit
-- is not a review. But immutable also meant unmoderatable, so a defamatory or
-- abusive review had no remedy short of deleting the row, which destroys the
-- evidence of the thing being complained about. Two narrow, audited mutations
-- are added instead, and everything else about a review stays frozen.
--
--   1. An admin may HIDE a review. Hiding is not deletion: the row, its text,
--      who wrote it and when all survive. It stops counting toward the tutor's
--      rating and stops being publicly readable.
--   2. A tutor may REPLY to a review about them, once. A right of reply is
--      the proportionate answer to an unfair-but-not-rule-breaking review,
--      and it is far better for a marketplace than a takedown.

alter table public.reviews
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references public.profiles (id),
  add column if not exists hidden_reason text,
  add column if not exists tutor_reply text,
  add column if not exists tutor_replied_at timestamptz;

alter table public.reviews
  drop constraint if exists reviews_tutor_reply_length;
alter table public.reviews
  add constraint reviews_tutor_reply_length
  check (tutor_reply is null or length(trim(tutor_reply)) between 1 and 2000);

-- A hidden review must carry who hid it and why, or the audit trail is a
-- timestamp with no accountability attached to it.
alter table public.reviews
  drop constraint if exists reviews_hidden_is_attributed;
alter table public.reviews
  add constraint reviews_hidden_is_attributed
  check (
    (hidden_at is null and hidden_by is null and hidden_reason is null)
    or (hidden_at is not null and hidden_by is not null and hidden_reason is not null)
  );

-- Ratings now exclude hidden reviews, and recompute on UPDATE as well as
-- INSERT — without the UPDATE branch, hiding a 1-star review would remove it
-- from the page while leaving it in the tutor's average, which is the half of
-- moderation that actually matters to them.
create or replace function public.recompute_tutor_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.tutor_id, old.tutor_id);
begin
  update public.tutor_profiles
  set
    total_reviews = (
      select count(*) from public.reviews
      where tutor_id = target and hidden_at is null
    ),
    avg_rating = (
      select round(avg(rating)::numeric, 1) from public.reviews
      where tutor_id = target and hidden_at is null
    )
  where id = target;
  return coalesce(new, old);
end;
$$;

drop trigger if exists recompute_tutor_rating_after_review on public.reviews;
create trigger recompute_tutor_rating_after_review
  after insert or update or delete on public.reviews
  for each row execute function public.recompute_tutor_rating();

-- A hidden review vanishes from public view but stays visible to its author
-- (so they are not silently censored) and to admins (so the decision can be
-- reviewed). The tutor it concerns does NOT regain sight of it once hidden:
-- the usual reason for hiding is that the exchange needs to stop.
drop policy if exists "reviews_select_all" on public.reviews;
create policy "reviews_select_visible_or_privileged"
  on public.reviews for select
  using (hidden_at is null or public.is_admin() or auth.uid() = student_id);

-- Admins moderate; tutors reply to their own reviews. The column lock below
-- is what keeps these two narrow rather than a general licence to edit.
create policy "reviews_update_admin"
  on public.reviews for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "reviews_update_reply_by_tutor"
  on public.reviews for update
  using (auth.uid() = tutor_id and hidden_at is null)
  with check (auth.uid() = tutor_id);

create or replace function public.protect_review_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'postgres' then
    return new;
  end if;

  -- The review itself is immutable for everyone including admins and the
  -- service role. Moderation hides a review; it never rewrites one.
  if (new.id, new.booking_id, new.student_id, new.tutor_id, new.rating, new.comment, new.created_at)
     is distinct from
     (old.id, old.booking_id, old.student_id, old.tutor_id, old.rating, old.comment, old.created_at) then
    raise exception 'a review''s content cannot be changed after it is submitted'
      using errcode = '42501';
  end if;

  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    -- A tutor's only permitted mutation, and only once: an editable reply
    -- lets a tutor answer, wait for the student to see it, then swap it.
    if (to_jsonb(new) - 'tutor_reply' - 'tutor_replied_at')
       is distinct from (to_jsonb(old) - 'tutor_reply' - 'tutor_replied_at') then
      raise exception 'a tutor may only add a reply to a review'
        using errcode = '42501';
    end if;
    if old.tutor_reply is not null then
      raise exception 'you have already replied to this review'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_review_columns
  before update on public.reviews
  for each row execute function public.protect_review_columns();

grant update on public.reviews to authenticated; -- scoped by the policies and lock above

-- The public review list joins this view for author names; it must not leak
-- the author of a hidden review.
drop view if exists public.review_authors;
create view public.review_authors
with (security_invoker = off) as
select p.id, p.full_name, p.avatar_url
from public.profiles p
where exists (
  select 1 from public.reviews r where r.student_id = p.id and r.hidden_at is null
);

grant select on public.review_authors to authenticated;

create index reviews_hidden_idx on public.reviews (tutor_id) where hidden_at is null;
