-- Account lifecycle: age gating, tutor rejection reasons, and erasure.
--
-- =========================================================================
-- AGE GATING — A DELIBERATE, RESTRICTIVE DEFAULT. >>> REQUIRES LEGAL REVIEW <<<
-- =========================================================================
-- Nothing in this codebase previously asked how old anyone was, while the
-- product connects adults to learners over video. Whether RoyalPal may serve
-- minors is a legal question with statutory answers that differ by
-- jurisdiction (background screening, guardian consent, contact monitoring,
-- record retention), and it is not a question an engineer may answer by
-- choosing a default quietly.
--
-- So the schema takes the only position that is safe to take without advice:
-- RoyalPal is 18+. date_of_birth is required for new accounts and the
-- application refuses signup below 18. Loosening this to admit minors is a
-- deliberate, reviewed change with a safeguarding programme attached — it is
-- not a config flag, and this comment exists so nobody mistakes it for one.
--
-- Existing rows are left null: backfilling a birth date nobody supplied would
-- be inventing personal data. The application treats null as "pre-dates the
-- age gate" and prompts on next profile edit rather than locking the account
-- out of a product it already paid for.
alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists age_confirmed_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_date_of_birth_sane;
alter table public.profiles
  add constraint profiles_date_of_birth_sane
  check (
    date_of_birth is null
    or (date_of_birth > '1900-01-01'::date and date_of_birth < current_date)
  );

-- date_of_birth joins role and status in 0027's privileged-column lock: a
-- self-service age field that the user can edit at will is not an age gate.
-- It is writable exactly once, when it is still null.
create or replace function public.protect_profile_date_of_birth()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and not public.is_admin()
     and old.date_of_birth is not null
     and new.date_of_birth is distinct from old.date_of_birth then
    raise exception 'date of birth cannot be changed; contact support'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_profile_date_of_birth
  before update on public.profiles
  for each row execute function public.protect_profile_date_of_birth();

-- =========================================================================
-- TUTOR REJECTION REASONS
-- =========================================================================
-- setTutorVerification could reject an application but not say why, so the
-- notification said "please review and update your profile" to someone with
-- no way of knowing what was wrong. That is a support ticket by construction.
alter table public.tutor_profiles
  add column if not exists rejection_reason text,
  add column if not exists rejection_notes text,
  add column if not exists verification_decided_at timestamptz,
  add column if not exists verification_decided_by uuid references public.profiles (id);

alter table public.tutor_profiles
  drop constraint if exists tutor_profiles_rejection_reason_length;
alter table public.tutor_profiles
  add constraint tutor_profiles_rejection_reason_length
  check (rejection_reason is null or length(trim(rejection_reason)) between 1 and 120);

-- =========================================================================
-- ERASURE
-- =========================================================================
-- A deletion request, not an immediate delete, and anonymisation rather than
-- a DELETE statement. Three reasons, in order of how badly each would hurt:
--
--   1. Bookings and payments are financial records with their own retention
--      duties. Cascading a profile delete through them would destroy the
--      platform's record of money it processed. >>> REQUIRES LEGAL REVIEW <<<
--   2. A completed lesson has two parties. Erasing one of them must not erase
--      the other's history of it.
--   3. Account takeover. An instant, irreversible delete behind a session is
--      a weapon; a grace period during which the owner is emailed and can
--      cancel is the standard mitigation.
--
-- What anonymisation means here is defined in lib/actions/account.ts and the
-- scheduled job, not in SQL, because "which fields are personal" is a policy
-- question that will change.
alter table public.profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists anonymized_at timestamptz;

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text,
  -- When the grace period expires and the job may act.
  scheduled_for timestamptz not null,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- One live request per user. A partial unique index rather than a constraint,
-- because a user who cancels and re-requests must be able to.
create unique index account_deletion_requests_live_idx
  on public.account_deletion_requests (user_id)
  where cancelled_at is null and completed_at is null;

create index account_deletion_requests_due_idx
  on public.account_deletion_requests (scheduled_for)
  where cancelled_at is null and completed_at is null;

alter table public.account_deletion_requests enable row level security;

create policy "account_deletion_requests_select_own_or_admin"
  on public.account_deletion_requests for select
  using (auth.uid() = user_id or public.is_admin());

-- Requesting and cancelling both run server-side through the service role:
-- the request has to email the account owner and schedule work, and the
-- cancellation has to be attributable. Neither is a bare row write.
grant select on public.account_deletion_requests to authenticated;
grant all on public.account_deletion_requests to service_role;
