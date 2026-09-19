-- Terms acceptance, recorded at signup.
--
-- Consent is only meaningful if it can be evidenced: WHO accepted, WHEN, and
-- WHICH VERSION of the document. A checkbox that gates a form but writes
-- nothing down proves none of those things the day it matters. The version
-- string is the part people forget — "they accepted the terms" is worthless
-- if the terms have since been rewritten and nobody can say which text was on
-- screen. >>> REQUIRES LEGAL REVIEW: retention period and what must be
-- recorded are legal questions, not engineering ones. <<<
alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

-- Carries the age gate through signup.
--
-- The profile row is created inside the auth.users insert (0012) precisely so
-- there is no window in which an account exists without one. That means
-- date_of_birth has to arrive the same way — through signUp()'s options.data —
-- or the age check would live only in the Server Action, where it is one
-- unvalidated direct call to the Supabase Auth API away from being bypassed.
--
-- The check is duplicated here rather than delegated to the application on
-- purpose. This is the same reasoning as 0029's insert invariants: the
-- Server Action is the front door, and this is the lock on the door it is
-- standing in front of. A signup that somehow reaches auth.users without a
-- valid, adult date of birth fails the whole transaction.
--
-- Accounts created BEFORE this migration have a null date_of_birth and are
-- left alone: inventing a birth date nobody supplied would be fabricating
-- personal data, and locking an existing user out of a product they already
-- use is a worse answer than prompting them at next profile edit.
--
-- >>> The 18 below is the restrictive default from 0036. REQUIRES LEGAL REVIEW <<<
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_role public.user_role;
  signup_full_name text;
  signup_dob date;
begin
  signup_role := nullif(new.raw_user_meta_data ->> 'role', '')::public.user_role;
  signup_full_name := nullif(new.raw_user_meta_data ->> 'full_name', '');

  if signup_role is null then
    raise exception 'signup metadata missing a valid role';
  end if;

  if signup_role = 'admin' then
    raise exception 'admin accounts cannot be self-registered';
  end if;

  if signup_full_name is null then
    raise exception 'signup metadata missing full_name';
  end if;

  -- A malformed date is rejected rather than coerced to null: silently
  -- dropping it would turn a bad request into an account with no age on
  -- record, which is the one outcome this whole mechanism exists to prevent.
  begin
    signup_dob := nullif(new.raw_user_meta_data ->> 'date_of_birth', '')::date;
  exception when others then
    raise exception 'signup metadata has an invalid date_of_birth';
  end;

  if signup_dob is null then
    raise exception 'signup metadata missing date_of_birth';
  end if;

  -- Whole years, by calendar arithmetic. age() handles leap years and the
  -- day-before-birthday boundary that interval division gets wrong.
  if extract(year from age(current_date, signup_dob)) < 18 then
    raise exception 'RoyalPal is only available to users aged 18 and over';
  end if;

  insert into public.profiles
    (id, role, full_name, date_of_birth, age_confirmed_at, terms_accepted_at, terms_version)
  values (
    new.id,
    signup_role,
    signup_full_name,
    signup_dob,
    now(),
    now(),
    nullif(new.raw_user_meta_data ->> 'terms_version', '')
  );

  if signup_role = 'student' then
    insert into public.student_profiles (id) values (new.id);
  end if;

  return new;
end;
$$;
