-- payments is written exclusively by the Stripe webhook handler using the
-- service role key, which bypasses RLS entirely. No insert/update/delete
-- policy is defined here on purpose: no client (student, tutor, or admin
-- acting through the normal authenticated session) can ever write this
-- table directly, only read their own rows.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  stripe_payment_intent_id text not null unique,
  amount_cents integer not null check (amount_cents >= 0),
  status public.payment_status not null default 'requires_payment',
  currency text not null default 'usd',
  created_at timestamptz not null default now()
);

alter table public.payments enable row level security;

create policy "payments_select_participant_or_admin"
  on public.payments for select
  using (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and (b.student_id = auth.uid() or b.tutor_id = auth.uid())
    )
    or public.is_admin()
  );
