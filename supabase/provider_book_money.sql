-- What a stay, a visit or a purchase was worth — when the provider says so.
--
-- NOT YET APPLIED when written. Phase 9. Safe to re-run.
--
-- ONE nullable column, and the nullability is the whole design. Pippy does not
-- invoice, does not take payment and does not know anybody's rate card. This is
-- a number a provider may type if they want their own totals to mean money
-- instead of nights, and every screen has to read correctly when it is absent —
-- which, for most rows, it will be.
--
-- Deliberately NOT built:
--   · no currency column. Every provider is in India and a second currency with
--     no exchange rate is a column that silently adds rupees to dollars.
--   · no paid/unpaid, no invoice, no due date. The moment this app tracks what
--     is owed it is an accounting system, and a half-built one loses somebody
--     real money. If that is wanted it is its own phase, with its own thought.
--
-- numeric(12,2), not float: money in a float is how a total ends in .9999998.
-- The CHECK rejects a negative, which can only be a typo — a refund is not a
-- booking with a minus sign in front of it, and modelling one would need the
-- accounting this deliberately does not have.

ALTER TABLE public.provider_appointments
  ADD COLUMN IF NOT EXISTS amount numeric(12,2);

DO $$
BEGIN
  ALTER TABLE public.provider_appointments
    ADD CONSTRAINT provider_appointments_amount_not_negative
    CHECK (amount IS NULL OR amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;   -- safe to re-run
END $$;

-- ── Boundary tests ──────────────────────────────────────────────────────────
--
-- Run by scripts/sql-harness/run.sh (npm run test:sql). What they pin:
--
--   a booking with no amount ............................. null, not 0
--   a business sets one on its own booking ............... works
--   a negative amount .................................... refused by CHECK
--   a DIFFERENT business still reads nothing ............. 0 rows
--
-- The last one matters more than it looks: `amount` is the first column in the
-- book that is commercially sensitive about the PROVIDER rather than the pet,
-- so it is worth pinning that it inherits the same policy as the rest of the
-- row and did not arrive with a hole in it.
