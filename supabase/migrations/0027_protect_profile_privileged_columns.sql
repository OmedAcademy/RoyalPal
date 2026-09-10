-- Locks profiles.role and profiles.status against self-service writes.
--
-- profiles_update_own_or_admin (0002) scopes writes to the caller's own ROW,
-- but RLS cannot scope COLUMNS. With their own session token any user can
-- PATCH /rest/v1/profiles directly — bypassing every Server Action — and set
-- role = 'admin' (after which is_admin() opens every admin policy and
-- authorizeAdmin() passes) or lift their own suspension with status = 'active'.
-- handle_new_user (0012) refuses 'admin' at signup only; nothing guarded the
-- row afterwards. profiles_insert_own is covered too, for any auth user that
-- lacks a profiles row.
--
-- SECURITY INVOKER is deliberate. The trusted-writer test reads current_user,
-- which inside a SECURITY DEFINER function is always the owner — that would
-- make the check pass for everyone. As invoker, current_user is:
--   authenticated / anon  -> a PostgREST client: untrusted
--   service_role          -> webhooks and admin Server Actions: trusted
--   postgres (or other)   -> SQL editor, and SECURITY DEFINER functions such
--                            as handle_new_user(): trusted
-- current_user also cannot be forged the way the request.jwt.claims setting
-- behind auth.role() can.
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'admin' or new.status is distinct from 'active' then
      raise exception 'profiles.role and profiles.status are platform-controlled'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- is_admin() reads the row as it was before this statement, so a user
  -- cannot satisfy it with the very update being checked.
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not public.is_admin() then
    raise exception 'only an admin can change profiles.role or profiles.status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_profile_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();
