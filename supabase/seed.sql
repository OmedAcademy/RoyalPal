-- Local/dev seed data only. Never run against production.
-- Subjects are the only rows seeded here; profiles/tutor_profiles depend on
-- auth.users rows that must be created through Supabase Auth first (see M1
-- testing notes), so they are not seeded here.

insert into public.subjects (name, category, slug) values
  ('Spanish', 'Language', 'spanish'),
  ('French', 'Language', 'french'),
  ('English (IELTS Prep)', 'Test Prep', 'ielts-prep'),
  ('Calculus', 'Math', 'calculus'),
  ('Algebra', 'Math', 'algebra'),
  ('Python Programming', 'Programming', 'python-programming')
on conflict (name) do nothing;
