-- APPLIED 2026-09-21 as migration `user_providers`. Kept here so the schema
-- change lives in the repo, not only in the database. Safe to re-run.
--
-- "My providers": each account's own list of vets, boarders, groomers and
-- shops, replacing vet_name / vet_phone / vet_email on `pets` — three columns
-- that allowed exactly one vet per pet and no groomer, boarder or store at all.
--
-- A row either points at the shared directory (provider_id set) or was typed in
-- by the owner (provider_id null). Either way `name` and the contact fields are
-- a SNAPSHOT taken when it was added, which matters three times over:
--   · the list renders without joining 976 directory rows,
--   · it survives a directory entry being renamed or removed, and
--   · editing your entry never writes to the row every other user sees. That
--     last one is not a nicety: the directory is Google-sourced data under
--     rules that forbid altering it.

CREATE TABLE IF NOT EXISTS public.user_providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  -- Null means the whole household. Set means this pet overrides the household
  -- choice, for a pet that sees its own specialist.
  pet_id      uuid REFERENCES public.pets(id) ON DELETE CASCADE,
  category    text NOT NULL,
  name        text NOT NULL,
  phone       text, whatsapp text, email text, address text, website text,
  nickname    text, notes text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT user_providers_name_not_blank CHECK (btrim(name) <> '')
);

-- At most one primary per category per scope. Two partial indexes rather than
-- one constraint, because a NULL pet_id never collides with itself.
CREATE UNIQUE INDEX IF NOT EXISTS user_providers_primary_household
  ON public.user_providers(user_id, category) WHERE is_primary AND pet_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_providers_primary_pet
  ON public.user_providers(user_id, category, pet_id) WHERE is_primary AND pet_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_providers_no_dupe_household
  ON public.user_providers(user_id, provider_id) WHERE provider_id IS NOT NULL AND pet_id IS NULL;
CREATE INDEX IF NOT EXISTS user_providers_user_idx ON public.user_providers(user_id);
CREATE INDEX IF NOT EXISTS user_providers_pet_idx  ON public.user_providers(pet_id);

ALTER TABLE public.user_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_user_providers ON public.user_providers;
CREATE POLICY own_user_providers ON public.user_providers
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Someone you shared a pet with sees that pet's providers — they need the vet's
-- number as much as you do. Household rows stay private: sharing one pet is not
-- sharing your whole address book.
DROP POLICY IF EXISTS shared_pet_providers_select ON public.user_providers;
CREATE POLICY shared_pet_providers_select ON public.user_providers
  FOR SELECT USING (pet_id IS NOT NULL AND public.is_pet_member(pet_id));

-- ── One-time carry-over, idempotent ─────────────────────────────────────────
INSERT INTO public.user_providers (user_id, pet_id, category, name, phone, email, is_primary, notes)
SELECT p.user_id, p.id, 'Vet', btrim(p.vet_name),
       nullif(btrim(coalesce(p.vet_phone,'')),''),
       nullif(btrim(coalesce(p.vet_email,'')),''),
       true, 'Carried over from this pet''s vet details.'
FROM public.pets p
WHERE coalesce(btrim(p.vet_name),'') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.user_providers up WHERE up.pet_id = p.id AND up.category = 'Vet');

-- Verified against production in a rolled-back transaction before applying:
--   owner adds household + pet-override primary ... allowed
--   two household primaries in one category ...... blocked
--   shared VIEWER sees ........................... 1 row (pet-scoped only)
--   shared member edits my provider .............. blocked
--   anonymous sees ............................... 0 rows
--   blank name ................................... rejected
--   account deletion ............................. removes them too
