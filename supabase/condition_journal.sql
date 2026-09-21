-- APPLIED 2026-09-21 as migrations `condition_photo_journal` and
-- `drop_broken_pet_photo_trigger`. Kept here so the schema lives in the repo.
--
-- Dated photos and notes tracking a condition over time, so an owner can show a
-- vet how a paw looked three weeks ago rather than describing it from memory.
--
-- Threads rather than a flat list, because the question a vet asks is "is it
-- bigger than it was?" — which needs two dated photos of the same spot.
--
-- The bucket is PRIVATE. These are the most sensitive records the app holds; a
-- public bucket means anyone with the URL can view them indefinitely, and URLs
-- leak through referrers and shared screenshots. Clients get short-lived signed
-- URLs instead.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pet-photos', 'pet-photos', false, 8388608,
        ARRAY['image/jpeg','image/png','image/webp','image/heic'])
ON CONFLICT (id) DO NOTHING;

-- Object paths are <pet_id>/<condition_id>/<uuid>.jpg, so the first folder
-- segment is the pet — which is what the sharing model already keys on. The
-- regex guard is load-bearing: casting a non-UUID folder name would RAISE
-- rather than simply failing the check.
DROP POLICY IF EXISTS "pet photos readable by pet members" ON storage.objects;
CREATE POLICY "pet photos readable by pet members" ON storage.objects FOR SELECT
USING (bucket_id = 'pet-photos'
       AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
       AND public.is_pet_member(((storage.foldername(name))[1])::uuid));

DROP POLICY IF EXISTS "pet photos writable by pet editors" ON storage.objects;
CREATE POLICY "pet photos writable by pet editors" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'pet-photos'
       AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
       AND public.is_pet_editor(((storage.foldername(name))[1])::uuid));

DROP POLICY IF EXISTS "pet photos deletable by pet editors" ON storage.objects;
CREATE POLICY "pet photos deletable by pet editors" ON storage.objects FOR DELETE
USING (bucket_id = 'pet-photos'
       AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
       AND public.is_pet_editor(((storage.foldername(name))[1])::uuid));

CREATE TABLE IF NOT EXISTS public.conditions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id      uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body_part   text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','monitoring','resolved')),
  started_on  date NOT NULL DEFAULT current_date,
  resolved_on date,
  notes       text,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT conditions_title_not_blank CHECK (btrim(title) <> '')
);

CREATE TABLE IF NOT EXISTS public.condition_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id uuid NOT NULL REFERENCES public.conditions(id) ON DELETE CASCADE,
  observed_on  date NOT NULL DEFAULT current_date,
  description  text,
  photo_paths  text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conditions_pet_idx ON public.conditions(pet_id);
CREATE INDEX IF NOT EXISTS condition_notes_condition_idx ON public.condition_notes(condition_id);

ALTER TABLE public.conditions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condition_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conditions_select ON public.conditions;
CREATE POLICY conditions_select ON public.conditions FOR SELECT USING (public.is_pet_member(pet_id));
DROP POLICY IF EXISTS conditions_write ON public.conditions;
CREATE POLICY conditions_write ON public.conditions FOR ALL
  USING (public.is_pet_editor(pet_id)) WITH CHECK (public.is_pet_editor(pet_id));

DROP POLICY IF EXISTS condition_notes_select ON public.condition_notes;
CREATE POLICY condition_notes_select ON public.condition_notes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.conditions c WHERE c.id = condition_id AND public.is_pet_member(c.pet_id)));
DROP POLICY IF EXISTS condition_notes_write ON public.condition_notes;
CREATE POLICY condition_notes_write ON public.condition_notes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.conditions c WHERE c.id = condition_id AND public.is_pet_editor(c.pet_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.conditions c WHERE c.id = condition_id AND public.is_pet_editor(c.pet_id)));

-- ── A trigger that was tried and reverted, recorded so nobody tries it again ─
--
-- Postgres cascades ROWS, but stored objects are outside that graph, so
-- deleting a pet would leave its photos in the bucket forever. The obvious fix
-- is a BEFORE DELETE trigger removing them from storage.objects. Supabase
-- forbids that outright:
--
--     Direct deletion from storage tables is not allowed.
--     Use the Storage API instead.
--
-- So the trigger did not merely fail to clean up — it RAISED on every pet
-- delete, which would also have broken account deletion, since that cascades
-- through pets. Photo cleanup belongs in the server-side delete path, which can
-- call the Storage API with the service role. See
-- netlify/functions/delete-account.js step 5.

-- Verified against production, impersonating each role:
--   OWNER read / write ................ true / true
--   shared VIEWER read / write ........ true / false
--   UNRELATED user read ............... false
--   ANONYMOUS read .................... false
--   non-uuid folder ................... rejected by the regex guard, not raised
