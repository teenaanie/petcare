-- A Supabase-shaped stub, for testing supabase/*.sql on a throwaway Postgres.
--
-- This exists so a policy can be ATTACKED rather than read. It is not a model of
-- Supabase; it is the smallest thing that makes auth.uid(), the anon and
-- authenticated roles, and RLS behave the way they do in the real project.
--
-- The one thing it must get right, and the reason it grants ALL on every table
-- to anon and authenticated at the end, is this: in Supabase those roles hold
-- broad table privileges and RLS is what actually gates them. A stub that
-- withheld the grant would make every "blocked" below pass for the wrong
-- reason, which is precisely the false pass the 2026-09-16 privacy audit
-- correction was about.

CREATE ROLE anon         NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role  NOLOGIN;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text,
  phone      text,
  created_at timestamptz DEFAULT now()
);
-- Deliberately NOT granted to anon/authenticated: in Supabase they cannot read
-- auth.users either, which is the whole reason current_user_email() and
-- current_user_phone() have to be SECURITY DEFINER.

-- Supabase reads the JWT claim. Driven here by set_config in the tests.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '');
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

-- ── The parts of the live schema these files lean on ────────────────────────

-- providers, trimmed to the columns provider_accounts.sql actually joins.
CREATE TABLE public.providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text,
  area        text,
  city        text,
  is_approved boolean DEFAULT false
);
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
-- No policy, mirroring live: the directory is read through search_providers(),
-- a SECURITY DEFINER function, not through the table.

-- ── Fixtures ────────────────────────────────────────────────────────────────
--
-- These are inserted BEFORE the migrations run, because that is the real
-- ordering: on the live project auth.users and providers predate anything in
-- this phase. Seeding them afterwards would have admins.sql find no user to
-- bind its seeded row to, and the harness would then be testing the fresh-
-- project path while production took the other one.
--
-- OWNER is the address admins.sql seeds, so the tests exercise the real owner
-- path rather than a synthetic admin.

INSERT INTO auth.users (id, email, phone) VALUES
  ('11111111-1111-1111-1111-111111111111', 'teena.anie9@gmail.com', '+919000000001'),
  ('22222222-2222-2222-2222-222222222222', 'boarder@unleash.test',  '+919000000002'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@example.test', '+919000000003'),
  ('44444444-4444-4444-4444-444444444444', 'invited@kennel.test',   '+919000000004');

INSERT INTO public.providers (id, name, type, area, city, is_approved) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Unleash - The Dog Town', 'Boarder', 'Baner',  'Pune', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Vetic Pet Clinic Aundh', 'Vet',     'Aundh',  'Pune', true);

-- feedback, as it exists live before provider_feedback.sql runs: the same
-- columns and the same two policies. provider_feedback.sql then alters it, so
-- the harness proves the pet-parent insert path survives that alteration.
CREATE TABLE public.feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid,
  rating     integer,
  category   text,
  message    text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Only the INSERT policy: live also has "Admin reads all feedback", which calls
-- is_admin() and so cannot be created before admins.sql has run. No assertion
-- reads feedback as an admin, and provider_feedback.sql only touches INSERT.
CREATE POLICY "Users can insert own feedback" ON public.feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- From pet_members.sql, verbatim.
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT email::text FROM auth.users WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.current_user_email() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_email() FROM anon;
GRANT  EXECUTE ON FUNCTION public.current_user_email() TO authenticated;
