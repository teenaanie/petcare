-- Provider enrichment: run this in your Supabase SQL editor (safe to re-run).
-- Adds the attributes needed for the Google Maps provider import and
-- locality-based ("area") search.

ALTER TABLE providers ADD COLUMN IF NOT EXISTS area         text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS rating       numeric(2,1);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS reviews_count integer;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS lat          numeric(10,7);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS lng          numeric(10,7);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS postal_code  text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS categories   text[];
ALTER TABLE providers ADD COLUMN IF NOT EXISTS place_id     text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS source       text DEFAULT 'manual';

-- place_id is Google's stable identifier — makes the import idempotent, so
-- re-running it updates existing rows instead of creating duplicates.
-- Partial index so the many manually-added rows with NULL place_id don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS providers_place_id_unique
  ON providers(place_id) WHERE place_id IS NOT NULL;

-- Directory groups and filters by area, so index it.
CREATE INDEX IF NOT EXISTS providers_area_idx ON providers(area);
CREATE INDEX IF NOT EXISTS providers_type_idx ON providers(type);

-- The original CHECK constraint only allowed the first four types, so the two
-- categories added later were silently unsaveable in production — both from the
-- admin form and the public registration form. Widen it to all six.
ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_type_check;
ALTER TABLE providers ADD CONSTRAINT providers_type_check CHECK (
  type IN ('Vet', 'Groomer', 'Store', 'Boarder', 'Special Services', 'Pet Loss & Memorial Services')
);
