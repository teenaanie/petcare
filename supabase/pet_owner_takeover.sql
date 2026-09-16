-- APPLIED 2026-09-16 as migration block_pet_ownership_takeover_by_editors.
-- Kept here so the schema change is in the repo, not only in the database.
--
-- The hole: an editor on a shared pet could rewrite pets.user_id to themselves,
-- becoming the owner, and then delete the pet and its entire medical history.
--
-- "Editors can update shared pets" is UPDATE USING is_pet_editor(id) with no
-- WITH CHECK, so Postgres reuses USING as the check. is_pet_editor(id) is still
-- true after the owner column changes, because membership is keyed on pet_id and
-- not on who owns it. The own_pets WITH CHECK then passes as well, since the new
-- user_id equals auth.uid(). Both halves pass, and the pet changes hands.
--
-- This was missed on the first pass because the test was wrong, not because the
-- test passed: it created a pet_members row carrying only an email and set a
-- matching JWT claim, but is_pet_editor() resolves the caller's email from
-- auth.users rather than from the claim. The "attacker" was never an editor, so
-- "blocked" measured nothing. Any test of a permission boundary has to first
-- prove the actor really holds the permission being tested.
--
-- An RLS policy cannot see the row as it was, so it cannot tell "edit this pet"
-- from "take this pet". A BEFORE UPDATE trigger can.
--
-- SECURITY INVOKER (the default) is deliberate. The function needs no elevated
-- rights, and as INVOKER current_user is the real caller rather than the
-- function's owner — which the service_role check depends on. A first attempt
-- used SECURITY DEFINER and locked the serverless functions out of their own
-- database.

CREATE OR REPLACE FUNCTION public.pets_block_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF current_user <> 'service_role'
       AND coalesce(auth.role(), '') <> 'service_role'
       AND OLD.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Only the current owner can transfer a pet';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pets_block_owner_change ON public.pets;
CREATE TRIGGER pets_block_owner_change
  BEFORE UPDATE ON public.pets
  FOR EACH ROW EXECUTE FUNCTION public.pets_block_owner_change();

-- Verified after applying, in a rolled-back transaction:
--   editor takes ownership ......... blocked
--   editor edits name/weight ....... allowed
--   owner edits own pet ............ allowed
--   owner transfers own pet ........ allowed
--   service_role writes ............ unaffected
--   account deletion cascade ....... intact
