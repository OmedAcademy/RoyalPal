-- Creates the profiles row (and student_profiles, where applicable)
-- atomically as part of the auth.users insert itself, rather than as a
-- separate application-level step after signUp() returns. This closes off
-- the failure mode where a user exists in auth.users but has no profiles
-- row — which would lock them out of nearly everything, since most RLS
-- policies call is_admin(), which reads profiles.
--
-- role/full_name come from the signUp() call's options.data (Supabase Auth
-- stores this as auth.users.raw_user_meta_data). If it's missing or
-- invalid, the whole signup transaction fails — better than silently
-- producing a broken account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_role public.user_role;
  signup_full_name text;
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

  insert into public.profiles (id, role, full_name)
  values (new.id, signup_role, signup_full_name);

  if signup_role = 'student' then
    insert into public.student_profiles (id) values (new.id);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
