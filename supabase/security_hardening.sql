-- Security hardening — ALREADY APPLIED to the live project.
-- Kept here so the schema stays reviewable in version control.
--
-- Found by Supabase's security advisors and confirmed by calling the endpoint
-- with the public anon key: get_all_users_for_admin returned every user's
-- email and phone to anyone holding that key, which ships in the browser
-- bundle. It is SECURITY DEFINER and had no caller check at all.

-- ── 1. Gate the user listing ────────────────────────────────────────────────
-- is_admin() covers the admin dashboard, which calls this as a signed-in user.
-- auth.role() covers the scheduled reminder function, which calls it with the
-- service key where auth.uid() is null. auth.role() reads the JWT claim, so it
-- survives SECURITY DEFINER switching current_user to the function owner.

CREATE OR REPLACE FUNCTION public.get_all_users_for_admin()
RETURNS TABLE(id uuid, email text, phone text, created_at timestamp with time zone, pet_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    u.id,
    u.email::text,
    u.phone::text,
    u.created_at,
    COUNT(p.id)::bigint AS pet_count
  FROM auth.users u
  LEFT JOIN public.pets p ON p.user_id = u.id
  WHERE public.is_admin() OR coalesce(auth.role(), '') = 'service_role'
  GROUP BY u.id, u.email, u.phone, u.created_at
  ORDER BY u.created_at DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_all_users_for_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_all_users_for_admin() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_all_users_for_admin() TO authenticated;

-- ── 2. Pin search_path on the SECURITY DEFINER helpers ──────────────────────
-- Without a pinned search_path these run with the owner's privileges while
-- resolving unqualified names against the caller's search_path.

CREATE OR REPLACE FUNCTION public.is_pet_member(check_pet_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.pets WHERE id = check_pet_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.pet_members
    WHERE pet_id = check_pet_id
      AND (user_id = auth.uid() OR email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_pet_editor(check_pet_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.pets WHERE id = check_pet_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.pet_members
    WHERE pet_id = check_pet_id AND role = 'editor'
      AND (user_id = auth.uid() OR email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
$function$;

-- ── 3. Stop the signup trigger being callable as an RPC ─────────────────────
-- Triggers run as the table owner, so revoking the API grants doesn't affect
-- the trigger itself.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- never block user creation
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- ── Known, deliberately left alone ──────────────────────────────────────────
-- * search_providers / provider_facets stay callable by anon: the directory is
--   read-only public data and that grant is intentional.
-- * agent_runs and profiles have RLS on with no policies, which denies all
--   API access and is the safe default. Note this means App.jsx's fallback
--   admin check against profiles.is_admin can never read a row — the email
--   check is what actually works.
