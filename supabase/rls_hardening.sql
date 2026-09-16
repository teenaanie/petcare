-- Row-level security hardening — run in the Supabase SQL editor. Safe to re-run.
--
-- Found by auditing every policy against live roles. Core tenant isolation was
-- already sound: a signed-in stranger and an anonymous visitor can read nothing
-- belonging to another user, cannot update or delete another user's pet, cannot
-- grant themselves membership, cannot write to the provider directory, and
-- cannot make themselves an admin. Two narrower problems, both below.

-- ── 1. Anyone could write to the AI rate-limit table ─────────────────────────
--
-- The policy was:
--     "service role inserts"  INSERT  TO public  WITH CHECK (true)
--
-- The name states the intent, but the grant is to `public`, which includes
-- `anon` and `authenticated`. WITH CHECK (true) places no constraint on
-- user_id, so any visitor — signed in or not — could insert usage rows
-- attributed to somebody else and exhaust that person's monthly AI quota
-- (MONTHLY_SCAN_LIMIT / MONTHLY_AI_LIMIT). Verified against the live database.
--
-- The policy was never needed: `service_role` bypasses RLS entirely, and the
-- three serverless functions are the only writers. Removing it costs nothing.
DROP POLICY IF EXISTS "service role inserts" ON public.api_usage;

-- Defence in depth. Supabase grants every table to anon and authenticated by
-- default, leaving RLS as the only gate; here there is no reason for either
-- role to hold write privileges at all.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.api_usage FROM anon, authenticated;

-- "users see own usage" (SELECT USING auth.uid() = user_id) stays as it is.

-- ── 2. pet_members raised a hard error for signed-out visitors ───────────────
--
-- Its SELECT policy calls current_user_email(), and `anon` had no EXECUTE on
-- that function, so any anonymous read of pet_members failed with
-- "permission denied for function current_user_email" instead of returning no
-- rows. This is the same shape as the earlier "permission denied for table
-- users" bug, and it fails closed rather than open — a broken error message,
-- not a leak.
--
-- The function is SECURITY DEFINER with a pinned search_path and returns the
-- caller's own email, which for anon is NULL. Granting EXECUTE discloses
-- nothing and lets the policy evaluate to false the way it was meant to.
GRANT EXECUTE ON FUNCTION public.current_user_email() TO anon;

-- ── Deliberately unchanged ───────────────────────────────────────────────────
--
-- public.agent_runs has RLS enabled and no policies. The linter flags this as
-- INFO, but deny-everything is correct for a table only the service role
-- touches. Leave it.
