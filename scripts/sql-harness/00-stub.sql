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
  type        text NOT NULL,
  phone       text,
  area        text,
  city        text,
  address     text,
  whatsapp    text,
  hours       text,
  description text,
  maps_url    text,
  source      text,
  -- Added for provider_self_service.sql: the columns a business may edit about
  -- itself, plus the criteria a pet parent reads before they travel.
  email           text,
  website         text,
  boarding_policy jsonb,
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
  ('44444444-4444-4444-4444-444444444444', 'invited@kennel.test',   '+919000000004'),
  -- The second admin admins.sql seeds. Present here because they have a real
  -- account on the live project, and the seed's user_id backfill only has
  -- something to bind to when that is true.
  ('55555555-5555-5555-5555-555555555555', 'tins08@gmail.com',      '+919000000005'),
  -- Used only by the adoption block, which counts the rows it adopts and so
  -- needs an address no other block has claimed. provider_accounts carries a
  -- unique index on (provider_id, lower(email)) and several blocks reuse the
  -- seeded addresses, which made an earlier attempt here count two rows and
  -- read the wrong one's status.
  ('77777777-7777-4777-8777-777777777777', 'adopter@kennel.test',   '+919000000007');

INSERT INTO public.providers (id, name, type, area, city, is_approved) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Unleash - The Dog Town', 'Boarder', 'Baner',  'Pune', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Vetic Pet Clinic Aundh', 'Vet',     'Aundh',  'Pune', true),
  -- UNAPPROVED on purpose. A business whose listing is not published cannot
  -- read its own row through the directory's policy, so this is the fixture
  -- that proves my_provider_details() answers where a plain SELECT cannot.
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Quiet Paws Boarding',    'Boarder', 'Kothrud','Pune', false);

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

-- ── What provider_notes.sql leans on ────────────────────────────────────────

-- pets, trimmed to what provider_notes references and the policy helpers read.
CREATE TABLE public.pets (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name    text NOT NULL,
  species text
);
ALTER TABLE public.pets ENABLE ROW LEVEL SECURITY;

-- Live is `(user_id = auth.uid() OR is_admin())`, but is_admin() does not exist
-- yet — this stub runs before admins.sql, the same ordering that keeps the
-- feedback policy above partial. The admin half is dropped rather than faked
-- because nothing in the note assertions reads pets as an admin, and the half
-- that matters here is the owner one. is_pet_member/is_pet_editor are SECURITY
-- DEFINER and bypass this policy regardless, which is the point of them.
CREATE POLICY own_pets ON public.pets
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Sharing a pet with a second person. is_pet_member/is_pet_editor both read it,
-- and the email branch is the one that matters here: it is how an invited
-- editor is recognised before they have ever signed in.
CREATE TABLE public.pet_members (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id  uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  user_id uuid,
  email   text,
  role    text NOT NULL DEFAULT 'viewer'
);
ALTER TABLE public.pet_members ENABLE ROW LEVEL SECURITY;

-- From pet_members.sql, verbatim. Copied rather than imported because the live
-- file carries much more than provider_notes.sql needs, and a stub that drifts
-- from these two functions would make every note assertion meaningless.
CREATE OR REPLACE FUNCTION public.is_pet_member(check_pet_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pets WHERE id = check_pet_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.pet_members
    WHERE pet_id = check_pet_id
      AND (user_id = auth.uid() OR email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pet_editor(check_pet_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pets WHERE id = check_pet_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.pet_members
    WHERE pet_id = check_pet_id AND role = 'editor'
      AND (user_id = auth.uid() OR email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_pet_member(uuid), public.is_pet_editor(uuid)
  TO anon, authenticated, service_role;

-- ── What stay_updates.sql leans on ──────────────────────────────────────────
--
-- Supabase's storage schema, trimmed to the three things the photo policies
-- touch. Worth stubbing rather than skipping: the storage policies are where a
-- boarder could otherwise reach into a bucket of someone's pet photographs, so
-- they deserve attacking like any other policy.

CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE storage.buckets (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  public boolean NOT NULL DEFAULT false
);

CREATE TABLE storage.objects (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name      text NOT NULL,
  owner     uuid
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Supabase's own helper: splits an object path into its folder segments.
-- Reproduced rather than approximated, because every photo policy in this repo
-- keys on foldername(name)[1] and an off-by-one here would make them all pass
-- against the wrong segment.
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE parts text[];
BEGIN
  parts := string_to_array(name, '/');
  RETURN parts[1:array_length(parts, 1) - 1];
END $$;

GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
