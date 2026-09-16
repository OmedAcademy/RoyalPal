-- Locks the tutor_profiles columns the PLATFORM owns.
--
-- tutor_profiles_update_own_or_admin and tutor_profiles_insert_own (0003) scope
-- writes to the tutor's own ROW, not its columns. A tutor calling PostgREST
-- directly could set:
--   platform_fee_bps = 0       -> createBooking charges no commission
--   stripe_charges_enabled     -> skips the Connect booking gate
--   stripe_account_id          -> becomes transfer_data.destination
--   avg_rating / total_reviews -> tops the search ranking
-- and, through INSERT — the path every new tutor's first profile save takes —
-- verification_status = 'approved', which protect_tutor_verification_status
-- guards on UPDATE only.
--
--   system only (service role / definer functions):
--     stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled,
--     stripe_details_submitted, stripe_requirements_due,
--     stripe_disabled_reason, avg_rating, total_reviews
--   admin or system:  platform_fee_bps
--   tutor-editable:   everything else
--
-- SECURITY INVOKER for the reason given in 0027. It matters doubly here:
-- recompute_tutor_rating (0008) updates avg_rating from inside a SECURITY
-- DEFINER function while auth.role() still reports the reviewing student's
-- 'authenticated' JWT — a clone of the auth.role() check would reject that
-- update and break every review submission.
--
-- protect_tutor_verification_status still owns verification_status on UPDATE
-- and is not replaced. Requires 0025 and 0026.
create or replace function public.protect_tutor_platform_columns()
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
    -- Column defaults are already applied to NEW here, so a legitimate first
    -- save passes untouched; only an explicitly supplied value is refused.
    if new.verification_status is distinct from 'pending'
       or new.stripe_account_id is not null
       or new.stripe_charges_enabled is distinct from false
       or new.stripe_payouts_enabled is distinct from false
       or new.stripe_details_submitted is distinct from false
       or new.stripe_requirements_due is distinct from '{}'::text[]
       or new.stripe_disabled_reason is not null
       or new.avg_rating is not null
       or new.total_reviews is distinct from 0
       or new.platform_fee_bps is not null then
      raise exception 'tutor_profiles platform-controlled columns cannot be set by the tutor'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_charges_enabled is distinct from old.stripe_charges_enabled
     or new.stripe_payouts_enabled is distinct from old.stripe_payouts_enabled
     or new.stripe_details_submitted is distinct from old.stripe_details_submitted
     or new.stripe_requirements_due is distinct from old.stripe_requirements_due
     or new.stripe_disabled_reason is distinct from old.stripe_disabled_reason
     or new.avg_rating is distinct from old.avg_rating
     or new.total_reviews is distinct from old.total_reviews then
    raise exception 'Stripe account state and ratings are system-controlled'
      using errcode = '42501';
  end if;

  if new.platform_fee_bps is distinct from old.platform_fee_bps
     and not public.is_admin() then
    raise exception 'only an admin can change tutor_profiles.platform_fee_bps'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_tutor_platform_columns
  before insert or update on public.tutor_profiles
  for each row execute function public.protect_tutor_platform_columns();
