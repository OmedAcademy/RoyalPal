-- Extensions
create extension if not exists "pgcrypto";
-- Required for the GiST exclusion constraint that prevents double-booking a tutor.
create extension if not exists "btree_gist";

-- Enums
create type public.user_role as enum ('student', 'tutor', 'admin');
create type public.user_status as enum ('active', 'suspended');
create type public.tutor_verification_status as enum ('pending', 'approved', 'rejected');
create type public.booking_status as enum (
  'pending_payment',
  'confirmed',
  'completed',
  'cancelled',
  'refunded'
);
create type public.payment_status as enum (
  'requires_payment',
  'succeeded',
  'failed',
  'refunded'
);

-- Generic updated_at maintenance, reused by every table with an updated_at column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
