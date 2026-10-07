-- adopt_my_provider_accounts() — bind an email-matched claim to the account
-- that actually signed in.
--
-- NOT YET APPLIED when written. Safe to re-run.
--
-- ── The problem ─────────────────────────────────────────────────────────────
--
-- A claim can exist before anybody has signed in. api/_lib/register-provider.js
-- writes one carrying the address somebody typed into the registration form,
-- with user_id NULL, so that when that person later signs in at /business their
-- listing is already waiting rather than duplicated.
--
-- is_provider_member() and my_provider_accounts() both then fall back to an
-- email match, so the shell works. But the row never learns WHO its claimant
-- is. That is fine until the day they change their sign-in address, at which
-- point they silently lose access to their own business and nothing anywhere
-- explains why. It is already true of at least one real row on the live
-- project.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
--
-- On first successful sign-in, stamp user_id. After that the row is bound to an
-- account rather than to a string, and the email fallback is only ever the
-- bootstrap it was meant to be.
--
-- This needs SECURITY DEFINER because provider_accounts' UPDATE policy is
-- is_admin() and should stay that way: a provider must not be able to edit
-- their own claim. The function is the one narrow exception, and it is narrow
-- on purpose — see the three guards below.

CREATE OR REPLACE FUNCTION public.adopt_my_provider_accounts()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  mine  text;
  n     integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  -- The caller's own verified address, read from auth.users rather than taken
  -- as an argument. An argument would make this "adopt any claim whose email I
  -- can guess", which is the whole business.
  mine := public.current_user_email();
  IF coalesce(btrim(mine), '') = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.provider_accounts pa
  SET    user_id = auth.uid()
  WHERE  pa.user_id IS NULL                       -- never reassign somebody else's
    AND  pa.email IS NOT NULL
    AND  lower(pa.email) = lower(mine);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Three guards, and each is load-bearing:
--
--   auth.uid() IS NOT NULL   an anonymous caller adopts nothing. Combined with
--                            the REVOKE below this is belt and braces.
--   pa.user_id IS NULL       a claim already bound to an account is never
--                            reassigned. Without this, anyone who could get
--                            their address onto a claim could take over a
--                            business that somebody else is already running.
--   lower(email) = lower(mine)  the address comes from auth.users, so it is the
--                            one the caller proved they control by signing in.
--
-- What it deliberately does NOT do:
--
--   * It does not touch `status`. Adoption is not approval — a pending claim
--     stays pending and still waits for an admin. Binding identity and granting
--     access are two different decisions and this function makes only the first.
--   * It does not match on PHONE, although is_provider_member() does. That
--     fallback compares the last ten digits, which is loose enough for a read
--     that is already scoped to one business, and too loose to permanently bind
--     an identity to a row. A phone-only claim keeps working through the
--     existing fallback; it simply never gets adopted.

REVOKE EXECUTE ON FUNCTION public.adopt_my_provider_accounts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adopt_my_provider_accounts() FROM anon;
GRANT  EXECUTE ON FUNCTION public.adopt_my_provider_accounts() TO authenticated;

-- ── Boundary tests ──────────────────────────────────────────────────────────
--
-- Run by scripts/sql-harness/run.sh (npm run test:sql); assertions live in
-- scripts/sql-harness/10-tests.sql. What they pin:
--
--   an unbound claim matching my address ......... adopted, returns 1
--   and is now bound to me ....................... user_id = auth.uid()
--   its status is unchanged ...................... still pending
--   running it again ............................. returns 0, no-op
--   a claim bound to somebody else ............... untouched
--   a claim carrying a different address ......... untouched
--   anon calling it .............................. denied
