-- Admins: run this in your Supabase SQL editor (safe to re-run).
-- NOT YET APPLIED. Stamp the header above with the date once it is.
--
-- RUN THIS BEFORE provider_accounts.sql, which calls is_admin() in five places.
--
-- is_admin() already existed, but only in the live database — no file in this
-- repo created it, so the schema could not be rebuilt from the repo. Its body
-- was a single hardcoded address:
--
--   SELECT EXISTS (SELECT 1 FROM auth.users
--                  WHERE id = auth.uid() AND email = 'teena.anie9@gmail.com');
--
-- This file puts it under version control and moves the list into a table, so
-- approving a provider claim stops being a thing only one person can ever do.
-- Behaviour is unchanged on the day it runs: the seed below inserts exactly the
-- address the old body hardcoded.
--
-- Read this before changing anything here. is_admin() is SECURITY DEFINER and
-- already gates get_all_users_for_admin(), which returns EVERY user's email and
-- phone. Its body is not a convenience check — it is the door on that function,
-- and on every admin policy in provider_accounts.sql.

-- ── The table ───────────────────────────────────────────────────────────────
--
-- user_id OR email, the same shape pet_members and provider_accounts use: an
-- admin can be recorded before they have ever signed in, by address.

CREATE TABLE IF NOT EXISTS public.admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text,
  note       text,
  added_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at   timestamptz DEFAULT now(),
  -- Set rather than deleting the row, so "who used to be able to see every
  -- user's phone number, and until when" stays answerable.
  revoked_at timestamptz,
  CONSTRAINT admins_has_identity CHECK (
    user_id IS NOT NULL OR coalesce(btrim(email), '') <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS admins_user_uniq
  ON public.admins(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admins_email_uniq
  ON public.admins(lower(email)) WHERE email IS NOT NULL;

-- ── Seed ────────────────────────────────────────────────────────────────────
--
-- The address the old function hardcoded, so nothing changes the moment the
-- function below replaces it. user_id is filled from auth.users when a row for
-- that address exists, which on this project it does — see the note on the
-- email path in is_admin() for why a bound row is the one you want.

INSERT INTO public.admins (user_id, email, note)
SELECT (SELECT u.id FROM auth.users u WHERE lower(u.email::text) = lower(seed.addr) LIMIT 1),
       seed.addr,
       'Seeded from the address is_admin() hardcoded before this file existed.'
FROM (VALUES ('teena.anie9@gmail.com')) AS seed(addr)
WHERE NOT EXISTS (
  SELECT 1 FROM public.admins a WHERE lower(a.email) = lower(seed.addr)
);

-- Bind any email-only row to its user, and do it on every re-run.
--
-- This is not tidying. An email-only row is matched by address for as long as
-- it stays unbound, which means changing your address in Supabase Auth would
-- hand admin to whoever registers your old one. The insert above fills user_id
-- when the auth user already exists, but on a fresh project the admin row is
-- written before anyone has signed in — so without this, the row that grants
-- admin would stay address-matched forever, which is the weaker of the two
-- paths and the one nobody would remember to close by hand.
--
-- The NOT EXISTS keeps admins_user_uniq satisfied if a bound row for that user
-- somehow already exists.

UPDATE public.admins a
SET user_id = u.id
FROM auth.users u
WHERE a.user_id IS NULL
  AND a.email IS NOT NULL
  AND lower(u.email::text) = lower(a.email)
  AND NOT EXISTS (SELECT 1 FROM public.admins b WHERE b.user_id = u.id);

-- ── The function ────────────────────────────────────────────────────────────
--
-- Three changes beyond reading the table.
--
--   1. STABLE, where the live function was VOLATILE. A VOLATILE function cannot
--      be cached for the duration of a statement, so Postgres re-evaluated it
--      once per row in every policy that called it. is_pet_member() and
--      current_user_email() are both already STABLE; this was the odd one out.
--
--   2. An explicit auth.uid() IS NOT NULL guard. Without it the anon path
--      relies on a NULL comparison returning NULL rather than true, which is
--      correct but is the kind of correct that someone later "simplifies".
--
--   3. The email path applies only to a row with no user_id. A row bound to a
--      user_id is matched by that id alone, so changing your address in Supabase
--      Auth cannot hand admin to whoever registers your old one. An email-only
--      row is a bootstrap device: bind it by setting user_id once the person has
--      signed in. provider_accounts.sql guards its email path the same way.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins a
    WHERE a.revoked_at IS NULL
      AND auth.uid() IS NOT NULL
      AND (
        a.user_id = auth.uid()
        OR (a.user_id IS NULL
            AND a.email IS NOT NULL
            AND lower(a.email) = lower((SELECT u.email::text
                                        FROM auth.users u
                                        WHERE u.id = auth.uid())))
      )
  );
$$;

-- The live function was executable by PUBLIC. These grants are what it actually
-- needs and nothing more. The anon grant is load-bearing and is the exact
-- lesson of rls_hardening.sql: without it, an anonymous read of any table whose
-- policy calls this hard-errors with "permission denied for function" instead
-- of returning zero rows. It fails closed either way, but the error shape leaks
-- that the table exists and breaks signed-out rendering.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- SELECT for admins, and NO INSERT, UPDATE OR DELETE POLICY AT ALL. That
-- omission is the entire security property of this file: a table that grants
-- admin, and that a user could insert themselves into, is a privilege
-- escalation with extra steps. Adding or revoking an admin is a deliberate act
-- in the SQL editor or with the service key, not a button.
--
-- Do not add a write policy here to make an admin-management screen possible.
-- If that screen is ever wanted, it belongs behind a SECURITY DEFINER function
-- that re-checks is_admin() and refuses to let the caller revoke the last
-- remaining admin — which a bare policy cannot express.

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admins_select ON public.admins;
CREATE POLICY admins_select ON public.admins
  FOR SELECT USING (public.is_admin());

-- ── Verified ────────────────────────────────────────────────────────────────
--
-- `npm run test:sql` runs this file and provider_accounts.sql against a
-- throwaway PostgreSQL 16 and then attacks the policies as anon and as
-- authenticated. Results below are from that run, 2026-10-01, 44/44 passing.
--
-- READ THIS CAVEAT. The harness is a Supabase-SHAPED stub, not Supabase: it
-- fakes auth.uid(), auth.users and the three roles. It proves the policies and
-- grants in this file behave as intended, and it caught a real bug in
-- provider_accounts.sql that review had missed. It does NOT prove anything
-- about the live project's existing policies, GoTrue's behaviour, or PostgREST.
-- A green run is a reason to apply this with confidence, not a reason to skip
-- checking the admin dashboard still loads afterwards.
--
-- Two things the harness is careful about, because getting either wrong turns
-- the whole table into false passes:
--
--   · Every "blocked" below is preceded by a positive assertion proving the
--     role and identity took effect. The 2026-09-16 privacy audit correction
--     exists because a fixture that silently failed to grant a role turned
--     every subsequent "blocked" into a false pass.
--   · anon and authenticated are granted ALL on every table, as they are in
--     Supabase, so a denial here is RLS denying and not a missing grant.
--
--   owner calls is_admin() ........................... true
--   owner's seeded row is bound by user_id ........... true
--   owner selects admins ............................. 1 row
--   another signed-in user calls is_admin() .......... false
--   anonymous calls is_admin() ....................... false, NOT an error
--   anonymous selects admins ......................... 0 rows, NOT an error
--   non-admin selects admins ......................... 0 rows
--   non-admin inserts themselves into admins ......... blocked, 42501
--   owner inserts into admins as authenticated ....... blocked, 42501 (by design)
--   non-admin updates an admins row .................. 0 rows (no policy)
--   non-admin deletes an admins row .................. 0 rows (no policy)
--   owner deletes an admins row as authenticated ..... 0 rows (no policy, by design)
--   is_admin() is STABLE ............................. true (was VOLATILE live)
--   is_admin() pins search_path ...................... true
--   is_admin() not executable by PUBLIC .............. true (was, live)
--   re-running this whole file ....................... no duplicate seed row
--
-- Still to check by hand on the live project, after applying — the harness
-- cannot reach these:
--
--   owner loads the admin dashboard .................. get_all_users_for_admin()
--                                                      still returns rows
--   revoked_at set -> is_admin() for that person ..... expected false; the
--                                                      harness has no second
--                                                      admin to revoke
