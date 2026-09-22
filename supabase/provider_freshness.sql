-- supabase/provider_freshness.sql
--
-- Applied as migration `provider_freshness_tracking`.
--
-- THE DRIFT. `categories` is a snapshot of what Google said on the day the
-- business was scraped, and `type` is derived from `categories[1]`. Businesses
-- edit their listings. When one does, the row goes stale and nothing notices —
-- a pet parent looking for a vet does not find a clinic filed as a shop. Seven
-- rows were found in exactly that state on 2026-09-22, including one the owner
-- reported themselves.
--
-- THE TRAP UNDERNEATH IT. Correcting such a row against the live listing makes
-- its `type` disagree with its stored `categories` — which is indistinguishable
-- from a misclassification. Both the importer and the reclassifier re-derive
-- type from those stored categories, so either one would have quietly put the
-- error back. Measured, not assumed: re-running the reclassifier before this
-- change reported "6 Vet → Store, 2 Vet → Groomer, 8 total".
--
-- These two timestamps are what tell the cases apart:
--
--   type_verified_at > categories_synced_at   the TYPE is right and the
--                                             CATEGORIES are stale — re-scrape
--   no type_verified_at, and they disagree    the TYPE is suspect — review it
--
-- and that distinction is what `npm run check:drift` reports on.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS categories_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS type_verified_at     timestamptz,
  ADD COLUMN IF NOT EXISTS type_verified_note   text;

COMMENT ON COLUMN public.providers.categories_synced_at IS
  'When `categories` was last captured from the source listing. Set by the importer on every upsert. NULL means it predates this tracking.';
COMMENT ON COLUMN public.providers.type_verified_at IS
  'When `type` was last confirmed against live evidence by a human or a review pass. A row verified more recently than its categories were synced is a deliberate override: the reclassifier must not revert it.';
COMMENT ON COLUMN public.providers.type_verified_note IS
  'How the type was verified -- which source settled it.';

-- Best available estimate for rows that predate this: a scraped row's
-- categories were captured when the row was created. It is an estimate, and is
-- documented as one rather than presented as a measurement.
UPDATE public.providers
SET categories_synced_at = created_at
WHERE categories_synced_at IS NULL
  AND categories IS NOT NULL
  AND source = 'google_maps';

CREATE INDEX IF NOT EXISTS providers_staleness_idx
  ON public.providers (categories_synced_at NULLS FIRST)
  WHERE is_approved;

-- The 14 rows settled by the 2026-09-22 review (classifier proposed, evaluator
-- re-derived and reproduced each against the live listing). Universal Animal
-- Welfare Society is deliberately NOT here: its live primary category has no
-- home in PROVIDER_TYPES, so it is an open flag, not a verified row.
--
--   UPDATE public.providers SET
--     type_verified_at   = now(),
--     type_verified_note = 'Reviewed 2026-09-22: classifier proposed, evaluator
--                           re-derived from evidence against the live listing.'
--   WHERE id IN (...14 ids...);
--
-- Applied; recorded here for provenance rather than re-execution.
