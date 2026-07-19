-- M3: Profile Management — adds the fields needed for student/tutor
-- self-service profile editing. Reuses the existing profiles/
-- student_profiles/tutor_profiles tables rather than introducing parallel
-- ones, per the "do not duplicate data" requirement.

-- country lives on `profiles` (not per-role) because both students and
-- tutors need it and it's the same concept either way.
alter table public.profiles
  add column country text;

create type public.english_level as enum ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- student_profiles: rename the ambiguous preferred_languages to
-- target_languages (languages the student wants to learn), and add the
-- fields M3 asks for.
alter table public.student_profiles
  rename column preferred_languages to target_languages;

alter table public.student_profiles
  add column native_language text,
  add column english_level public.english_level;

-- tutor_profiles: rename languages -> languages_spoken (the tutor's own
-- spoken languages) to disambiguate from the new teaching_languages
-- (languages the tutor teaches in). Both are independent — a tutor could
-- speak Spanish and English but only teach English.
alter table public.tutor_profiles
  rename column languages to languages_spoken;

alter table public.tutor_profiles
  add column teaching_languages text[] not null default '{}',
  add column specializations text[] not null default '{}',
  add column years_experience smallint check (years_experience between 0 and 80),
  add column certifications text[] not null default '{}',
  add column education text,
  add column trial_price_cents integer check (trial_price_cents > 0),
  add column availability_note text;

-- Existing RLS policies on all three tables already gate select/insert/update
-- by `auth.uid() = id or is_admin()` at the row level, so no new policies are
-- needed for these additional columns.
