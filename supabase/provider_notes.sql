-- provider_notes — the inform note, and the whole provider-side read surface.
--
-- NOT YET APPLIED. Phase 2 of docs/provider-platform-plan.md. Safe to re-run.
--
-- A customer tells a boarder what the boarder needs to know about their pet, in
-- words the customer wrote and read before sending. That is the entire access
-- model. The provider gets no row from pets, vaccinations, allergies,
-- medicines, medical_records, bills, weight_logs, reminders, conditions,
-- condition_notes or boarding_trips — eleven tables keep exactly the policies
-- they have today, and a column added to any of them next year is invisible
-- here by construction rather than by a whitelist somebody has to remember to
-- update.
--
-- Depth control is the customer reading the exact text that goes out. No field
-- whitelist can be as trustworthy as that.

-- ── The table ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  pet_id        uuid NOT NULL REFERENCES public.pets(id)      ON DELETE CASCADE,
  sent_by       uuid NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,

  body          text  NOT NULL,
  facts         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Denormalised on purpose, the same call user_providers already makes and for
  -- the same reason: the provider must not need a join into pets or auth.users
  -- to render a note. That is what keeps the read surface at ONE table. It also
  -- means the customer chooses even their own contact detail, so nothing at all
  -- is disclosed implicitly.
  pet_label     text NOT NULL,
  contact_name  text,
  contact_phone text,
  contact_email text,

  -- Optional stay window. This is what turns a pile of notes into the provider
  -- dashboard without a booking system existing: future starts_on is upcoming,
  -- spanning today is current, the rest is past.
  starts_on     date,
  ends_on       date,

  sent_at       timestamptz NOT NULL DEFAULT now(),

  -- A re-send points at what it replaces. There is deliberately no withdrawn_at
  -- and no delete: a note cannot be taken back (decision 2). The provider's
  -- inbox shows only notes nothing else supersedes; the customer's own history
  -- shows the whole chain.
  supersedes    uuid REFERENCES public.provider_notes(id) ON DELETE SET NULL,

  CONSTRAINT provider_notes_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT provider_notes_window_ordered CHECK (
    starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on
  ),
  -- A note cannot supersede itself. Longer chains are the application's
  -- business; this only closes the one case the database can see for free.
  CONSTRAINT provider_notes_no_self_supersede CHECK (supersedes IS DISTINCT FROM id)
);

-- The provider's inbox reads by provider and orders by the stay window, and the
-- customer's history reads by pet. Both get an index; supersedes gets one
-- because "show me only notes nothing supersedes" is an anti-join on it.
CREATE INDEX IF NOT EXISTS provider_notes_provider_idx
  ON public.provider_notes (provider_id, starts_on DESC NULLS LAST, sent_at DESC);
CREATE INDEX IF NOT EXISTS provider_notes_pet_idx
  ON public.provider_notes (pet_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS provider_notes_supersedes_idx
  ON public.provider_notes (supersedes) WHERE supersedes IS NOT NULL;

ALTER TABLE public.provider_notes ENABLE ROW LEVEL SECURITY;

-- ── Policies ────────────────────────────────────────────────────────────────
--
-- SELECT  is_pet_member(pet_id) OR is_provider_member(provider_id)
-- INSERT  is_pet_editor(pet_id) AND sent_by = auth.uid()
-- UPDATE  not granted
-- DELETE  not granted
--
-- NO UPDATE, and this is load-bearing rather than tidy. RLS cannot restrict
-- which COLUMNS an UPDATE touches, so any UPDATE policy permissive enough to be
-- useful would also let a customer rewrite `body` after the provider had read
-- it — a note that silently changes under the reader is worse than one that is
-- merely stale. pet_owner_takeover.sql documents the same trap from the other
-- direction. Decision 2 means nothing needs UPDATE at all, so the simplest
-- answer is also the correct one.
--
-- NO DELETE either, for the same reason in a stronger form: a deletable note is
-- a withdrawable note. The row goes only when the pet goes, by cascade.

DROP POLICY IF EXISTS provider_notes_select ON public.provider_notes;
CREATE POLICY provider_notes_select ON public.provider_notes
  FOR SELECT
  USING (public.is_pet_member(pet_id) OR public.is_provider_member(provider_id));

-- sent_by = auth.uid() is not decoration. Without it an editor on a shared pet
-- could write a note attributed to somebody else, and attribution is the only
-- thing the provider has to judge who told them.
DROP POLICY IF EXISTS provider_notes_insert ON public.provider_notes;
CREATE POLICY provider_notes_insert ON public.provider_notes
  FOR INSERT
  WITH CHECK (public.is_pet_editor(pet_id) AND sent_by = auth.uid());

-- ── Which of my providers can be informed? ──────────────────────────────────
--
-- provider_accounts is not readable by a customer, and must not become so: it
-- carries the claimant's address and phone. This answers the one question the
-- pet screen needs — "does a real, approved account stand behind this listing?"
-- — and returns ids ONLY, nothing about the account behind them.
--
-- Takes the caller's own provider ids rather than scanning: the customer
-- already has them from user_providers, and passing them keeps this from
-- becoming a way to enumerate which businesses have signed up.

CREATE OR REPLACE FUNCTION public.onboarded_provider_ids(p_ids uuid[])
RETURNS TABLE (provider_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT pa.provider_id
  FROM public.provider_accounts pa
  WHERE pa.provider_id = ANY(coalesce(p_ids, '{}'::uuid[]))
    AND pa.status = 'active';
$$;

-- Signed-in only. An anonymous caller has no My Providers list to ask about,
-- and letting anon call it would turn it into exactly the enumeration oracle
-- the argument list exists to prevent.
REVOKE EXECUTE ON FUNCTION public.onboarded_provider_ids(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.onboarded_provider_ids(uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.onboarded_provider_ids(uuid[]) TO authenticated;

-- ── Boundary tests ──────────────────────────────────────────────────────────
--
-- Run by scripts/sql-harness/run.sh (npm run test:sql), not by hand. The
-- assertions live in scripts/sql-harness/10-tests.sql. Summary of what they
-- pin, so a reader of this file alone knows what is claimed:
--
--   a stranger reads a note ........................... 0 rows
--   the pet's owner reads it .......................... 1 row
--   the informed provider reads it .................... 1 row
--   a DIFFERENT approved provider reads it ............ 0 rows
--   a provider whose claim is still pending ........... 0 rows
--   a stranger inserts a note ......................... denied
--   the owner inserts one attributed to someone else .. denied
--   the owner inserts one attributed to themselves .... 1 row
--   anyone at all updates a note ...................... 0 rows
--   anyone at all deletes a note ...................... 0 rows
--   onboarded_provider_ids as anon .................... denied
--   onboarded_provider_ids hides a pending claim ...... 0 rows
--   onboarded_provider_ids returns the active one ..... 1 row
