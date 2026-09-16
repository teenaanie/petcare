-- Provider taxonomy: run this in your Supabase SQL editor (safe to re-run).
--
-- Adds the two multi-valued columns, and widens the type constraint for the
-- two new tabs. It deliberately does NOT reclassify any rows: the rules for
-- that live in src/lib/taxonomy.js so the importer and the backfill cannot
-- drift apart, and duplicating them here in SQL would guarantee they do.
--
-- After running this, do the data pass with:
--   node scripts/reclassify-providers.mjs            # dry run, prints everything
--   node scripts/reclassify-providers.mjs --apply

-- ── Columns ──────────────────────────────────────────────────────────────────
-- `categories` stays as the raw Google import. These two are the curated view
-- of it, so a re-import can re-derive without flattening an admin's edits.

ALTER TABLE providers ADD COLUMN IF NOT EXISTS services        text[];
ALTER TABLE providers ADD COLUMN IF NOT EXISTS specializations text[];

-- Both are searched through search_providers() and filtered on, so index them.
CREATE INDEX IF NOT EXISTS providers_services_idx        ON providers USING gin (services);
CREATE INDEX IF NOT EXISTS providers_specializations_idx ON providers USING gin (specializations);

-- ── Types ────────────────────────────────────────────────────────────────────
-- "Special Services" was defined in the importer as one regex —
--   /trainer|training|walker|breeder|photograph|behaviou?r|adoption|shelter/
-- — so it was never a category, it was whatever hadn't matched yet. Dog
-- Walking and Training come out of it as real tabs; what's left is a genuine
-- residual of a handful of rows.

ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_type_check;
ALTER TABLE providers ADD CONSTRAINT providers_type_check CHECK (
  type IN (
    'Vet', 'Groomer', 'Store', 'Boarder',
    'Dog Walking', 'Training',
    'Special Services', 'Pet Loss & Memorial Services'
  )
);
