-- The provider's own book: their customers, those customers' animals, and the
-- stays they have booked.
--
-- NOT YET APPLIED when written. Phase 7. Safe to re-run.
--
-- ── Why this does not contradict the access model ───────────────────────────
--
-- Everything built so far holds that "the note is the entire provider-side read
-- surface", and docs/provider-platform-plan.md defers provider-created bookings
-- with the reason "keeps every provider write out of the schema".
--
-- That reason was about a provider writing into a CUSTOMER'S data — into `pets`,
-- into medical records, into anything a pet parent owns. This is not that.
-- These three tables are the provider's own records about their own business:
-- the digital version of the ledger next to the phone. A boarder types
-- "Mrs Rao, 98765…, golden retriever called Simba, in 14th to 18th" because
-- that is their job, and most of their customers will never use Pippy at all.
--
-- So: nothing here reads or writes `pets`, `auth.users`, `vaccinations`, or any
-- other table a customer owns. The eleven tables that keep their policies keep
-- them.
--
-- ── A provider's pet is NEVER an app pet ────────────────────────────────────
--
-- provider_pets is a separate namespace from public.pets and they are never
-- merged, because merging means a provider writing into a row a pet parent
-- owns. When the same animal exists on both sides — the customer uses Pippy and
-- has sent an inform note — the provider LINKS their card to that note
-- (`provider_pets.note_id`). The link is a pointer, not a merge: the note still
-- carries everything the provider may see, and `provider_pets` still carries
-- only what the provider typed themselves.
--
-- That is the "independent capability as well" half. A provider can run their
-- whole book without a single customer using the app, and when one does, the
-- two halves meet at the link rather than one absorbing the other.

-- ── Customers ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text,
  email       text,
  notes       text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provider_customers_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS provider_customers_provider_idx
  ON public.provider_customers (provider_id, name);

-- ── Their animals ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_pets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id)           ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.provider_customers(id)  ON DELETE CASCADE,
  name        text NOT NULL,
  species     text,
  breed       text,
  notes       text,

  -- Optional pointer at an inform note, when this animal's owner also uses
  -- Pippy and has told this business about them. NOT a foreign key into
  -- public.pets: a provider must never hold a reference into a pet parent's
  -- row, and the note is the only thing they are entitled to see.
  note_id     uuid REFERENCES public.provider_notes(id) ON DELETE SET NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provider_pets_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS provider_pets_customer_idx ON public.provider_pets (customer_id, name);
CREATE INDEX IF NOT EXISTS provider_pets_provider_idx ON public.provider_pets (provider_id, name);
CREATE INDEX IF NOT EXISTS provider_pets_note_idx     ON public.provider_pets (note_id) WHERE note_id IS NOT NULL;

-- ── Bookings ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_appointments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES public.providers(id)          ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.provider_customers(id) ON DELETE CASCADE,
  -- Nullable so a booking can be made against a customer before their animal
  -- has been typed in, which is how it happens on the phone.
  provider_pet_id uuid REFERENCES public.provider_pets(id) ON DELETE SET NULL,

  kind          text NOT NULL DEFAULT 'Boarding',
  starts_on     date NOT NULL,
  ends_on       date,
  -- A grooming slot has a time; a boarding stay has only dates. Both optional
  -- so neither case has to invent the other's precision.
  starts_at     time,
  status        text NOT NULL DEFAULT 'booked',
  notes         text,

  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provider_appointments_window_ordered CHECK (
    ends_on IS NULL OR ends_on >= starts_on
  ),
  CONSTRAINT provider_appointments_status_known CHECK (
    status IN ('booked', 'completed', 'cancelled', 'no_show')
  )
);

CREATE INDEX IF NOT EXISTS provider_appointments_diary_idx
  ON public.provider_appointments (provider_id, starts_on DESC);
CREATE INDEX IF NOT EXISTS provider_appointments_customer_idx
  ON public.provider_appointments (customer_id, starts_on DESC);

ALTER TABLE public.provider_customers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_pets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_appointments ENABLE ROW LEVEL SECURITY;

-- ── Policies ────────────────────────────────────────────────────────────────
--
-- All three are the same shape, and it is the simplest in the whole schema:
--
--   ALL  is_provider_member(provider_id)   on both USING and WITH CHECK
--
-- The provider owns these rows outright, so unlike provider_notes there is no
-- asymmetry to encode: they may read, write, correct and delete their own book,
-- exactly as they could a paper one. The only thing the policy enforces is that
-- it is THEIR book — an active account on that business, which is the same gate
-- every other provider-side table uses.
--
-- WITH CHECK matters as much as USING here: without it a provider could move a
-- row to another business by updating provider_id, which is the one way a
-- write-everything policy can still leak.
--
-- No pet parent can read any of this, deliberately. A customer has no standing
-- to see a boarder's private notes about them, and granting it would turn a
-- working ledger into a published one — the boarder would stop writing the
-- truth in it.

DROP POLICY IF EXISTS provider_customers_all ON public.provider_customers;
CREATE POLICY provider_customers_all ON public.provider_customers
  FOR ALL
  USING      (public.is_provider_member(provider_id))
  WITH CHECK (public.is_provider_member(provider_id));

DROP POLICY IF EXISTS provider_pets_all ON public.provider_pets;
CREATE POLICY provider_pets_all ON public.provider_pets
  FOR ALL
  USING      (public.is_provider_member(provider_id))
  WITH CHECK (
    public.is_provider_member(provider_id)
    -- The customer must belong to the same business, or a provider could file
    -- an animal under somebody else's customer by passing its id.
    AND EXISTS (
      SELECT 1 FROM public.provider_customers c
      WHERE c.id = customer_id AND c.provider_id = provider_pets.provider_id
    )
    -- A linked note must be one sent to THIS business. Without this a provider
    -- could point a card at any note id and, through it, at a pet they were
    -- never told about.
    AND (note_id IS NULL OR EXISTS (
      SELECT 1 FROM public.provider_notes n
      WHERE n.id = note_id AND n.provider_id = provider_pets.provider_id
    ))
  );

DROP POLICY IF EXISTS provider_appointments_all ON public.provider_appointments;
CREATE POLICY provider_appointments_all ON public.provider_appointments
  FOR ALL
  USING      (public.is_provider_member(provider_id))
  WITH CHECK (
    public.is_provider_member(provider_id)
    AND EXISTS (
      SELECT 1 FROM public.provider_customers c
      WHERE c.id = customer_id AND c.provider_id = provider_appointments.provider_id
    )
    AND (provider_pet_id IS NULL OR EXISTS (
      SELECT 1 FROM public.provider_pets p
      WHERE p.id = provider_pet_id AND p.provider_id = provider_appointments.provider_id
    ))
  );

-- ── Boundary tests ──────────────────────────────────────────────────────────
--
-- Run by scripts/sql-harness/run.sh (npm run test:sql); assertions live in
-- scripts/sql-harness/10-tests.sql. What they pin:
--
--   a business writes and reads its own book ........... works
--   a DIFFERENT business reads it ..................... 0 rows
--   a SUSPENDED claimant reads it ..................... 0 rows
--   a pet parent reads it ............................. 0 rows
--   anon reads it ..................................... 0 rows
--   filing a pet under another business's customer .... denied
--   linking a card to another business's note ......... denied
--   booking against another business's customer ....... denied
--   moving a row to another business by UPDATE ........ denied
--   an unknown status ................................. refused by CHECK
--   a stay ending before it starts .................... refused by CHECK
--   deleting a customer takes their pets and bookings . cascade
