-- Provider sign-in: run this in your Supabase SQL editor (safe to re-run).
-- NOT YET APPLIED. Stamp the header above with the date once it is.
--
-- Until now a provider was a row in a directory: 968 of them, scraped from
-- Google Maps, with no way for the business itself to sign in or see anything.
-- This binds an auth.users row to a providers row so a boarder can reach their
-- own shell at /business.
--
-- Three things worth knowing before reading the policies:
--
--   1. The account, not the login, is what is separate. A boarder is often
--      also a pet parent, and Supabase will not create two auth.users rows for
--      one email address. The two sides are told apart by session (a separate
--      storageKey in src/lib/supabase.js), NOT by auth.uid(), which is
--      identical in both. No policy here can distinguish "signed in as a
--      provider" from "signed in as a pet parent", and none tries to. Do not
--      build on the assumption that it can.
--
--   2. Anyone could claim "Unleash – The Dog Town". So a claim lands
--      status='pending' and an admin approves it — the same posture
--      register-provider.js already takes with is_approved=false.
--
--   3. Nothing provider-related may ever be added to the `providers` table.
--      search_providers() returns to_jsonb(p) and is granted to anon, so every
--      column on it is world-readable to anyone holding the public key. An
--      owner's email on `providers` would be a leak; here it is not.

-- ── The account ─────────────────────────────────────────────────────────────
--
-- ON DELETE RESTRICT, not CASCADE: a directory row that somebody has claimed
-- carries their customers, pets and stays behind it. Deleting the listing must
-- fail loudly and make the admin deal with it, not silently delete a business's
-- entire book.

CREATE TABLE IF NOT EXISTS public.provider_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Held when an admin invites someone who has not signed in yet; matched to a
  -- user_id on their first visit by link_provider_account().
  email       text,
  phone       text,
  role        text NOT NULL DEFAULT 'owner'   CHECK (role   IN ('owner','staff')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  -- What the claimant said they are, captured at signup so the shell knows
  -- which profile to show before an admin has looked at it. The authority for
  -- the directory's own `type` stays providers.type; this is not that.
  claimed_type text,
  claim_note   text,
  granted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT provider_accounts_has_identity CHECK (
    user_id IS NOT NULL
    OR coalesce(btrim(email),'') <> ''
    OR coalesce(btrim(phone),'') <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_accounts_user_uniq
  ON public.provider_accounts(provider_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS provider_accounts_email_uniq
  ON public.provider_accounts(provider_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_accounts_user_idx     ON public.provider_accounts(user_id);
CREATE INDEX IF NOT EXISTS provider_accounts_provider_idx ON public.provider_accounts(provider_id);
CREATE INDEX IF NOT EXISTS provider_accounts_pending_idx  ON public.provider_accounts(status) WHERE status = 'pending';

-- ── Helpers ─────────────────────────────────────────────────────────────────
--
-- Companion to current_user_email(), which already exists. auth.users can only
-- be read from a SECURITY DEFINER function: a policy's expression runs as the
-- calling role, and `authenticated` has no SELECT on it.

CREATE OR REPLACE FUNCTION public.current_user_phone()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT phone::text FROM auth.users WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_phone() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_user_phone() TO authenticated;
-- anon too: see the note on is_provider_member below. Same reasoning.
GRANT  EXECUTE ON FUNCTION public.current_user_phone() TO anon;

-- "Am I staff at this business?" — the spine every provider-scoped policy in
-- the platform hangs off, mirroring is_pet_member().
--
-- Phone match is on the last 10 digits only. Indian numbers arrive as
-- "+91 98…", "098…" and "98…" for one person, and an exact comparison silently
-- fails to match the account an admin created by hand.
--
-- This reads provider_accounts while provider_accounts' own policy calls this
-- function. That does NOT recurse: the SECURITY DEFINER owner also owns the
-- table and bypasses RLS. is_pet_member()/pet_members already prove the shape
-- works — do not "fix" it.

CREATE OR REPLACE FUNCTION public.is_provider_member(check_provider_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.provider_accounts pa
    WHERE pa.provider_id = check_provider_id
      AND pa.status = 'active'
      AND (
        pa.user_id = auth.uid()
        OR (pa.user_id IS NULL AND pa.email IS NOT NULL
            AND lower(pa.email) = lower(public.current_user_email()))
        OR (pa.user_id IS NULL AND pa.phone IS NOT NULL
            AND right(regexp_replace(pa.phone, '\D', '', 'g'), 10)
              = right(regexp_replace(coalesce(public.current_user_phone(), ''), '\D', '', 'g'), 10)
            AND length(regexp_replace(coalesce(public.current_user_phone(), ''), '\D', '', 'g')) >= 10)
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_provider_member(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_provider_member(uuid) TO authenticated;
-- The anon grant is load-bearing, and is the exact lesson of rls_hardening.sql:
-- without it an anonymous read of any table whose policy calls this hard-errors
-- with "permission denied for function" instead of returning zero rows. It
-- fails closed either way, but the error shape leaks that the table exists and
-- breaks signed-out rendering. Same bug pet_members/current_user_email() had.
GRANT  EXECUTE ON FUNCTION public.is_provider_member(uuid) TO anon;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.provider_accounts ENABLE ROW LEVEL SECURITY;

-- SELECT: my own row (this is also how the client learns it is a provider at
-- boot — profiles has RLS with no policies and can never be read, so it is no
-- use as a role source), plus my colleagues' rows once I am active.
DROP POLICY IF EXISTS provider_accounts_select ON public.provider_accounts;
CREATE POLICY provider_accounts_select ON public.provider_accounts
  FOR SELECT USING (
    user_id = auth.uid()
    OR (email IS NOT NULL AND lower(email) = lower(public.current_user_email()))
    OR public.is_provider_member(provider_id)
    OR public.is_admin()
  );

-- INSERT: a signed-in user may claim a listing FOR THEMSELVES, pending only.
-- The WITH CHECK pins every field that would otherwise let a claim approve
-- itself — status, granted_at, granted_by and user_id are all constrained.
DROP POLICY IF EXISTS provider_accounts_claim ON public.provider_accounts;
CREATE POLICY provider_accounts_claim ON public.provider_accounts
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND granted_at IS NULL
    AND granted_by IS NULL
    AND revoked_at IS NULL
  );

DROP POLICY IF EXISTS provider_accounts_admin_insert ON public.provider_accounts;
CREATE POLICY provider_accounts_admin_insert ON public.provider_accounts
  FOR INSERT WITH CHECK (public.is_admin());

-- UPDATE: admin only. A provider cannot flip their own claim to active.
-- WITH CHECK is spelled out: without it Postgres reuses USING, and USING stays
-- true after the row changes — which is exactly how an editor could take
-- ownership of a pet (see pet_owner_takeover.sql).
DROP POLICY IF EXISTS provider_accounts_update ON public.provider_accounts;
CREATE POLICY provider_accounts_update ON public.provider_accounts
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS provider_accounts_delete ON public.provider_accounts;
CREATE POLICY provider_accounts_delete ON public.provider_accounts
  FOR DELETE USING (public.is_admin());

-- ── RPCs ────────────────────────────────────────────────────────────────────
--
-- The shell needs the business NAME, and `providers` has no user-facing SELECT
-- policy — the directory is read through search_providers(), a SECURITY
-- DEFINER function granted to anon. So a PostgREST join from provider_accounts
-- to providers would return nothing. These three functions do the join.

-- Boot. Returns only the caller's own accounts, whatever their status, so the
-- shell can tell "no account" from "awaiting approval" from "active".
CREATE OR REPLACE FUNCTION public.my_provider_accounts()
RETURNS TABLE (
  id uuid, provider_id uuid, status text, role text,
  claimed_type text, created_at timestamptz,
  provider_name text, provider_type text, provider_area text, provider_city text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT pa.id, pa.provider_id, pa.status, pa.role,
         pa.claimed_type, pa.created_at,
         p.name, p.type, p.area, p.city
  FROM public.provider_accounts pa
  JOIN public.providers p ON p.id = pa.provider_id
  WHERE auth.uid() IS NOT NULL
    AND (pa.user_id = auth.uid()
         OR (pa.email IS NOT NULL AND lower(pa.email) = lower(public.current_user_email())))
  ORDER BY pa.created_at;
$$;

REVOKE EXECUTE ON FUNCTION public.my_provider_accounts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_provider_accounts() FROM anon;
GRANT  EXECUTE ON FUNCTION public.my_provider_accounts() TO authenticated;

-- Submit a claim. A function rather than a bare insert so the duplicate case
-- returns the existing row instead of a constraint violation the UI would have
-- to decode, and so an admin-created row waiting on an email is adopted rather
-- than duplicated.
CREATE OR REPLACE FUNCTION public.claim_provider(p_provider_id uuid, p_claimed_type text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id) THEN
    RAISE EXCEPTION 'No such provider';
  END IF;

  SELECT id INTO existing_id FROM public.provider_accounts
  WHERE provider_id = p_provider_id AND user_id = auth.uid();
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  -- An admin invited this person by email before they ever signed in: adopt
  -- that row rather than creating a second one beside it.
  SELECT id INTO existing_id FROM public.provider_accounts
  WHERE provider_id = p_provider_id
    AND user_id IS NULL
    AND email IS NOT NULL
    AND lower(email) = lower(public.current_user_email());
  IF existing_id IS NOT NULL THEN
    UPDATE public.provider_accounts SET user_id = auth.uid() WHERE id = existing_id;
    RETURN existing_id;
  END IF;

  INSERT INTO public.provider_accounts (provider_id, user_id, email, status, claimed_type, claim_note)
  VALUES (p_provider_id, auth.uid(), public.current_user_email(), 'pending',
          nullif(btrim(coalesce(p_claimed_type, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''))
  RETURNING id INTO existing_id;
  RETURN existing_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_provider(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_provider(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_provider(uuid, text, text) TO authenticated;

-- The admin review queue. Gated internally, and returns nothing to anyone else.
CREATE OR REPLACE FUNCTION public.admin_provider_accounts()
RETURNS TABLE (
  id uuid, provider_id uuid, status text, role text, claimed_type text,
  claim_note text, email text, phone text, created_at timestamptz,
  provider_name text, provider_type text, provider_area text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT pa.id, pa.provider_id, pa.status, pa.role, pa.claimed_type,
         pa.claim_note, pa.email, pa.phone, pa.created_at,
         p.name, p.type, p.area
  FROM public.provider_accounts pa
  JOIN public.providers p ON p.id = pa.provider_id
  WHERE public.is_admin() OR coalesce(auth.role(), '') = 'service_role'
  ORDER BY (pa.status = 'pending') DESC, pa.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_provider_accounts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_provider_accounts() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_provider_accounts() TO authenticated;

-- ── Verify before trusting this ─────────────────────────────────────────────
--
-- Run these impersonating each role, inside BEGIN … ROLLBACK, and record the
-- results here. A test of a permission boundary must FIRST prove the actor
-- holds the permission being tested: assert is_provider_member() returns true
-- before attacking with it. The 2026-09-16 privacy audit correction exists
-- because a fixture that silently failed to grant a role turned every
-- subsequent "blocked" into a false pass.
--
--   anonymous selects provider_accounts .............. 0 rows, NOT an error
--   anonymous calls is_provider_member(<id>) ......... false, NOT an error
--   user claims a listing ............................ allowed, status='pending'
--   user claims the same listing twice ............... returns the same id
--   user inserts a row with status='active' .......... blocked
--   user updates their own row to status='active' .... blocked
--   user updates another provider's account .......... blocked
--   user selects another provider's account .......... 0 rows
--   admin approves a claim ........................... allowed
--   approved user: is_provider_member(theirs) ........ true
--   approved user: is_provider_member(another) ....... false
--   my_provider_accounts() as anon ................... permission denied (by design)
--   admin_provider_accounts() as non-admin ........... 0 rows
--   deleting a claimed providers row ................. blocked by RESTRICT
--   account deletion removes the provider_account .... verified
