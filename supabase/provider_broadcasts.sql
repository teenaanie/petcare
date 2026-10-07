-- provider_broadcasts — a business writing to the customers who wrote to it.
--
-- NOT YET APPLIED. Phase 5 of docs/provider-platform-plan.md. Safe to re-run.
--
-- The plan left one thing open before this could be built: "Someone should put
-- a number on a 100-customer broadcast before item 9 is built." The number
-- turned out to decide the design rather than merely constrain it.
--
--   EMAIL is per-send against a monthly allowance and, at a hundred recipients,
--   rounds to nothing.
--   SMS to Indian numbers is metered per message AND carries DLT template
--   registration, which is a compliance workflow rather than a line item.
--
-- So a broadcast is EMAIL ONLY. No Twilio leg exists in this feature and none
-- should be added without costing it first. A broadcast is not urgent — a
-- kennel announcing Diwali closures does not need to interrupt anybody — so
-- the expensive channel buys nothing here.
--
-- ── Who is a "customer"? ────────────────────────────────────────────────────
--
-- There is no customer list, and deliberately no new table for one. The only
-- relationship this system has ever recorded between a business and a person is
-- a note that person SENT that business. So the audience is exactly: people who
-- have informed you, who chose to include an email address when they did.
--
-- That last clause matters and costs reach on purpose. auth.users holds an
-- address for everyone, and using it would mean mailing people at an address
-- they never offered to this business. provider_notes.contact_email is one the
-- customer typed into a box labelled "How they can reach you". Only that one is
-- used. Fewer recipients is the correct answer, not a shortfall.

-- ── The record ──────────────────────────────────────────────────────────────
--
-- Written by the SERVER after a send, never by the client. It exists for two
-- reasons: a provider should be able to see what they sent, and the monthly
-- ceiling needs somewhere to count from.

CREATE TABLE IF NOT EXISTS public.provider_broadcasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  sent_by       uuid NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  subject       text NOT NULL,
  body          text NOT NULL,
  -- How many addresses it actually went to. NOT the addresses themselves: the
  -- provider never sees their customers' email, and a table they can read is
  -- the last place to put it.
  recipients    integer NOT NULL DEFAULT 0,
  failures      integer NOT NULL DEFAULT 0,
  sent_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provider_broadcasts_subject_not_blank CHECK (btrim(subject) <> ''),
  CONSTRAINT provider_broadcasts_body_not_blank    CHECK (btrim(body) <> ''),
  CONSTRAINT provider_broadcasts_counts_sane       CHECK (recipients >= 0 AND failures >= 0)
);

CREATE INDEX IF NOT EXISTS provider_broadcasts_provider_idx
  ON public.provider_broadcasts (provider_id, sent_at DESC);

ALTER TABLE public.provider_broadcasts ENABLE ROW LEVEL SECURITY;

-- ── Policies ────────────────────────────────────────────────────────────────
--
-- SELECT  is_provider_member(provider_id)   -- your own outbox
-- INSERT  not granted                       -- the server writes it
-- UPDATE  not granted
-- DELETE  not granted
--
-- NO INSERT POLICY, and that is the enforcement rather than an oversight. If a
-- provider could write this row from the client they could write it without
-- sending anything, which makes the monthly ceiling a suggestion — the count it
-- reads would be whatever the client chose to record. The row is written by
-- api/_lib/provider-broadcast.js with the service key, AFTER the send, with the
-- counts the send actually produced.
--
-- The same reasoning as provider_notes, arriving from the other direction:
-- there, no UPDATE because a reader must not have the text change underneath
-- them; here, no INSERT because a rate limit must not be self-reported.

DROP POLICY IF EXISTS provider_broadcasts_select ON public.provider_broadcasts;
CREATE POLICY provider_broadcasts_select ON public.provider_broadcasts
  FOR SELECT
  USING (public.is_provider_member(provider_id));

-- ── Boundary tests ──────────────────────────────────────────────────────────
--
-- Run by scripts/sql-harness/run.sh (npm run test:sql); the assertions live in
-- scripts/sql-harness/10-tests.sql. What they pin:
--
--   the business reads its own outbox ................. 1 row
--   a DIFFERENT business reads it ..................... 0 rows
--   a SUSPENDED claimant on the same business ......... 0 rows
--   a customer who was mailed reads it ................ 0 rows
--   an anonymous reader ............................... 0 rows
--   the provider inserts a broadcast themselves ....... denied
--   the provider edits the recorded count ............. 0 rows
--   the provider deletes an awkward one ............... 0 rows
--   a blank subject or body ........................... refused by CHECK
