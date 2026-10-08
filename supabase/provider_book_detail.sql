-- What a boarder actually records about a stay.
--
-- NOT YET APPLIED when written. Phase 8. Safe to re-run.
--
-- Phase 7 gave a booking dates, a kind and a status, which is enough for a
-- diary and not enough to run a kennel. Three things were missing, and all
-- three are things a boarder checks BEFORE the animal arrives or writes down
-- WHILE it is there:
--
--   trial_done    many boarding houses require a trial day before a first stay.
--                 Whether it happened is a yes/no the front desk needs at a
--                 glance, not a sentence buried in a note.
--   criteria_met  vaccinations seen, temperament fine, paperwork signed. The
--                 shape differs by business, so this is deliberately ONE flag
--                 and a free-text note rather than a checklist this schema
--                 invents on their behalf.
--   a day log     "ate well, slept through", day by day. Not the booking's own
--                 note, which is about the booking as a whole.

ALTER TABLE public.provider_appointments
  ADD COLUMN IF NOT EXISTS trial_done   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS criteria_met boolean NOT NULL DEFAULT false;

-- ── The day log ─────────────────────────────────────────────────────────────
--
-- A separate table rather than a jsonb column on the booking, because these are
-- written one at a time over days, by possibly different staff, and a jsonb
-- blob rewritten on every entry loses the last writer's line when two people
-- have the stay open at once. One row per entry also means `on_date` can be
-- indexed and ordered, which is the only way anybody reads them.
--
-- provider_id is denormalised onto the row so the policy does not join
-- provider_appointments on every read. The WITH CHECK then has to prove the
-- pair is real, exactly as provider_pets does for its customer.

CREATE TABLE IF NOT EXISTS public.provider_appointment_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.provider_appointments(id) ON DELETE CASCADE,
  provider_id    uuid NOT NULL REFERENCES public.providers(id)             ON DELETE CASCADE,
  on_date        date NOT NULL DEFAULT CURRENT_DATE,
  body           text NOT NULL,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provider_appointment_logs_body_not_blank CHECK (btrim(body) <> '')
);

CREATE INDEX IF NOT EXISTS provider_appointment_logs_idx
  ON public.provider_appointment_logs (appointment_id, on_date DESC, created_at DESC);

ALTER TABLE public.provider_appointment_logs ENABLE ROW LEVEL SECURITY;

-- Same shape as the rest of the book: the provider owns it outright.
DROP POLICY IF EXISTS provider_appointment_logs_all ON public.provider_appointment_logs;
CREATE POLICY provider_appointment_logs_all ON public.provider_appointment_logs
  FOR ALL
  USING      (public.is_provider_member(provider_id))
  WITH CHECK (
    public.is_provider_member(provider_id)
    -- The booking must belong to the same business, or a provider could attach
    -- a day's notes to another kennel's stay by passing its id.
    AND EXISTS (
      SELECT 1 FROM public.provider_appointments a
      WHERE a.id = appointment_id
        AND a.provider_id = provider_appointment_logs.provider_id
    )
  );

-- ── Boundary tests ──────────────────────────────────────────────────────────
--
-- Run by scripts/sql-harness/run.sh (npm run test:sql). What they pin:
--
--   a business writes a day's notes on its own booking .... works
--   and reads them back .................................. 1 row
--   a DIFFERENT business reads them ...................... 0 rows
--   a SUSPENDED claimant reads them ...................... 0 rows
--   a pet parent, and anon ............................... 0 rows
--   logging against another business's booking ........... denied
--   a blank entry ........................................ refused by CHECK
--   deleting the booking takes its log with it ........... cascade
--   trial_done and criteria_met default to false ......... both false
