create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  student_id uuid not null references public.profiles (id),
  tutor_id uuid not null references public.tutor_profiles (id),
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- Keeps tutor_profiles.avg_rating / total_reviews in sync automatically so
-- every read path (search, profile page) doesn't need to aggregate reviews
-- on every request.
create or replace function public.recompute_tutor_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tutor_profiles
  set
    total_reviews = (select count(*) from public.reviews where tutor_id = new.tutor_id),
    avg_rating = (select round(avg(rating)::numeric, 1) from public.reviews where tutor_id = new.tutor_id)
  where id = new.tutor_id;
  return new;
end;
$$;

create trigger recompute_tutor_rating_after_review
  after insert on public.reviews
  for each row execute function public.recompute_tutor_rating();

alter table public.reviews enable row level security;

create policy "reviews_select_all"
  on public.reviews for select
  using (true);

-- A student may only review a booking that is their own and already
-- completed, and the booking_id uniqueness constraint above guarantees at
-- most one review per booking.
create policy "reviews_insert_own_completed_booking"
  on public.reviews for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.status = 'completed'
    )
  );

-- No update/delete policy: reviews are immutable once submitted.

create index reviews_tutor_id_idx on public.reviews (tutor_id);
