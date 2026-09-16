-- Fix: "permission denied for table users" when opening Share on a pet.
-- Run this in your Supabase SQL editor. Safe to re-run.
--
-- pet_members' SELECT policy read auth.users inline:
--
--   CREATE POLICY "member_see_own_row" ON pet_members FOR SELECT USING (
--     user_id = auth.uid()
--     OR email = (SELECT email FROM auth.users WHERE id = auth.uid())   -- <—
--   );
--
-- A policy's expression runs as the CALLING role, and `authenticated` has no
-- SELECT on auth.users. So every read of pet_members failed — for the owner
-- too, because Postgres ORs all permissive policies together and evaluates
-- them all. The sharing dialog could therefore never list anybody.
--
-- The same auth.users lookup elsewhere (is_pet_member, is_pet_editor,
-- get_all_users_for_admin) was always fine: those are SECURITY DEFINER, so
-- they run as the owner. This one lookup just wasn't wrapped in anything.

CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT email::text FROM auth.users WHERE id = auth.uid();
$$;

-- Returns only the caller's own address — it is keyed on auth.uid() and takes
-- no argument, so it cannot be used to look anyone else up.
REVOKE EXECUTE ON FUNCTION public.current_user_email() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_email() FROM anon;
GRANT  EXECUTE ON FUNCTION public.current_user_email() TO authenticated;

DROP POLICY IF EXISTS "member_see_own_row" ON public.pet_members;
CREATE POLICY "member_see_own_row" ON public.pet_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR email = public.current_user_email()
  );
