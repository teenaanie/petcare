-- stay_updates — the boarder writing back during a stay.
--
-- NOT YET APPLIED. Phase 6 of docs/provider-platform-plan.md. Safe to re-run.
--
-- Everything built so far points one way: the customer tells the business about
-- their pet. This is the return leg, and it is the one a boarding customer
-- actually feels — "she ate everything and slept on the sofa", with a photo,
-- while they are nine hundred kilometres away.
--
-- ── What a stay update hangs off ────────────────────────────────────────────
--
-- A provider_notes row, and nothing else. That is the ONLY handle a provider
-- has on a pet: this shell cannot read pets, cannot read auth.users, and knows
-- an animal exists solely because somebody chose to tell it. Hanging updates
-- off the note keeps that true, and the note already carries the stay window,
-- so "which stay is this about" needs no new concept.
--
-- ── Why pet_id and provider_id are on the row ───────────────────────────────
--
-- Denormalised so the policies below do not have to join provider_notes on
-- every read, and so a pet's erasure cascades here directly rather than through
-- a chain. The INSERT policy then has to make sure the triple is REAL — a
-- provider who could pass any pet_id could post into a stranger's pet screen,
-- which is the one genuinely dangerous hole in this table. The EXISTS clause
-- against provider_notes is what closes it; it is not decoration.

CREATE TABLE IF NOT EXISTS public.stay_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     uuid NOT NULL REFERENCES public.provider_notes(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id)      ON DELETE CASCADE,
  pet_id      uuid NOT NULL REFERENCES public.pets(id)           ON DELETE CASCADE,
  posted_by   uuid NOT NULL REFERENCES auth.users(id)            ON DELETE CASCADE,

  body        text,
  -- A path in the private `stay-photos` bucket, never a URL. The browser gets a
  -- short-lived signed link, the same way the condition journal works.
  photo_path  text,

  created_at  timestamptz NOT NULL DEFAULT now(),

  -- An update with neither words nor a picture is not an update.
  CONSTRAINT stay_updates_has_content CHECK (
    coalesce(btrim(body), '') <> '' OR coalesce(btrim(photo_path), '') <> ''
  )
);

CREATE INDEX IF NOT EXISTS stay_updates_pet_idx
  ON public.stay_updates (pet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stay_updates_note_idx
  ON public.stay_updates (note_id, created_at DESC);

ALTER TABLE public.stay_updates ENABLE ROW LEVEL SECURITY;

-- ── Policies ────────────────────────────────────────────────────────────────
--
-- SELECT  is_pet_member(pet_id) OR is_provider_member(provider_id)
-- INSERT  is_provider_member(provider_id) AND posted_by = auth.uid()
--         AND the (note, provider, pet) triple is a real note
-- UPDATE  not granted
-- DELETE  is_provider_member(provider_id)
--
-- DELETE IS GRANTED HERE, and the contrast with provider_notes is deliberate
-- rather than inconsistent. A note cannot be withdrawn because the provider may
-- have acted on it and a fact that vanishes under a reader is worse than a
-- stale one. A stay update is the opposite shape: it is the provider's own
-- content, the customer relies on nothing, and the realistic failure is
-- photographing the wrong dog. Making that unremovable would turn a slip into a
-- privacy incident. So the person who posted it can take it down.
--
-- UPDATE is still not granted, for the usual reason: RLS cannot restrict which
-- columns an UPDATE touches, and there is nothing a provider needs to change
-- about an update that deleting and re-posting does not do more honestly.

DROP POLICY IF EXISTS stay_updates_select ON public.stay_updates;
CREATE POLICY stay_updates_select ON public.stay_updates
  FOR SELECT
  USING (public.is_pet_member(pet_id) OR public.is_provider_member(provider_id));

DROP POLICY IF EXISTS stay_updates_insert ON public.stay_updates;
CREATE POLICY stay_updates_insert ON public.stay_updates
  FOR INSERT
  WITH CHECK (
    posted_by = auth.uid()
    AND public.is_provider_member(provider_id)
    -- The triple must describe a note that actually exists, or a provider could
    -- post into any pet's screen by passing its id.
    AND EXISTS (
      SELECT 1 FROM public.provider_notes n
      WHERE n.id = note_id
        AND n.provider_id = stay_updates.provider_id
        AND n.pet_id      = stay_updates.pet_id
    )
  );

DROP POLICY IF EXISTS stay_updates_delete ON public.stay_updates;
CREATE POLICY stay_updates_delete ON public.stay_updates
  FOR DELETE
  USING (public.is_provider_member(provider_id));

-- ── The photo bucket ────────────────────────────────────────────────────────
--
-- A SEPARATE bucket from pet-photos, deliberately. pet-photos holds photographs
-- of skin conditions and wounds, and its policies are keyed on is_pet_member —
-- widening them to admit providers would give a boarder a foothold in the
-- bucket holding a pet's medical imagery to deliver a picture of a dog on a
-- sofa. The blast radius is not worth the one table saved.
--
-- Path is <note_id>/<uuid>.jpg, so storage RLS can resolve the note straight
-- out of the path, exactly as pet-photos resolves the pet id.

INSERT INTO storage.buckets (id, name, public)
VALUES ('stay-photos', 'stay-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Readable by either side of the note the photo hangs off.
DROP POLICY IF EXISTS "stay photos readable by either side" ON storage.objects;
CREATE POLICY "stay photos readable by either side" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'stay-photos'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.provider_notes n
      WHERE n.id = ((storage.foldername(name))[1])::uuid
        AND (public.is_pet_member(n.pet_id) OR public.is_provider_member(n.provider_id))
    )
  );

-- Written and removed only by the business the note was sent to. A pet's own
-- household can SEE these and cannot add to them: a stay update is the
-- provider's account of the stay, and a customer writing one would make it
-- something else.
DROP POLICY IF EXISTS "stay photos writable by the informed business" ON storage.objects;
CREATE POLICY "stay photos writable by the informed business" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'stay-photos'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.provider_notes n
      WHERE n.id = ((storage.foldername(name))[1])::uuid
        AND public.is_provider_member(n.provider_id)
    )
  );

DROP POLICY IF EXISTS "stay photos removable by the informed business" ON storage.objects;
CREATE POLICY "stay photos removable by the informed business" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'stay-photos'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.provider_notes n
      WHERE n.id = ((storage.foldername(name))[1])::uuid
        AND public.is_provider_member(n.provider_id)
    )
  );

-- ── Erasure ─────────────────────────────────────────────────────────────────
--
-- The ROWS cascade from pets and from provider_notes. The OBJECTS do not:
-- Supabase refuses deletes issued straight against storage.objects, which is
-- the same trap src/lib/conditions.js documents — deleting a pet there left
-- photographs of its skin condition in the bucket. deletePetPhotos() in that
-- file is the pattern; src/lib/stayUpdates.js carries the equivalent for this
-- bucket, and deletePet() calls both.

-- ── Boundary tests ──────────────────────────────────────────────────────────
--
-- Run by scripts/sql-harness/run.sh (npm run test:sql); assertions live in
-- scripts/sql-harness/10-tests.sql. What they pin:
--
--   the informed business posts an update ............. 1 row
--   the pet's owner reads it .......................... 1 row
--   a DIFFERENT active business reads it .............. 0 rows
--   a stranger, and anon .............................. 0 rows
--   the OWNER posts an update ......................... denied
--   a business posts against someone else's pet ....... denied
--   a business posts claiming another's note .......... denied
--   a business forges posted_by ....................... denied
--   a SUSPENDED business posts ........................ denied
--   an empty update (no body, no photo) ............... refused by CHECK
--   anyone updates a posted row ....................... 0 rows
--   the owner deletes the provider's update ........... 0 rows
--   the business deletes its own ...................... 1 row
