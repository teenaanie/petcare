-- Server-side provider search and facets — run in the Supabase SQL editor.
-- Safe to re-run.
--
-- Why: the directory used to fetch every provider and filter in the browser.
-- PostgREST caps responses at 1000 rows by default, so past that the directory
-- would have silently dropped providers. Filtering, counting and paging now
-- happen in Postgres.
--
-- Search lives in a function rather than a STORED generated column because the
-- expression has to flatten the categories array, and generated columns require
-- a strictly immutable expression. Inside a function it is evaluated per query,
-- so there is no such restriction.

-- ── Search + page ────────────────────────────────────────────────────────────
-- Returns each row as jsonb (so it keeps working if columns are added later)
-- plus the total match count, via a window function, so the client knows how
-- many more pages there are without a second round trip.

CREATE OR REPLACE FUNCTION search_providers(
  approved_only boolean DEFAULT true,
  filter_type   text    DEFAULT NULL,
  filter_area   text    DEFAULT NULL,
  search_term   text    DEFAULT NULL,
  page_limit    integer DEFAULT 60,
  page_offset   integer DEFAULT 0
)
RETURNS TABLE (provider jsonb, total_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(p) AS provider,
         count(*) OVER() AS total_count
  FROM public.providers p
  WHERE (NOT approved_only OR p.is_approved)
    AND (filter_type IS NULL OR p.type = filter_type)
    AND (filter_area IS NULL OR p.area = filter_area)
    AND (
      search_term IS NULL OR btrim(search_term) = '' OR
      p.name                                        ILIKE '%' || search_term || '%' OR
      coalesce(p.area, '')                          ILIKE '%' || search_term || '%' OR
      coalesce(p.city, '')                          ILIKE '%' || search_term || '%' OR
      coalesce(p.address, '')                       ILIKE '%' || search_term || '%' OR
      coalesce(p.type, '')                          ILIKE '%' || search_term || '%' OR
      coalesce(p.description, '')                   ILIKE '%' || search_term || '%' OR
      coalesce(array_to_string(p.categories, ' '), '') ILIKE '%' || search_term || '%' OR
      -- The curated tags, so "oncology", "dog walking" or "24 hour" find the
      -- right providers even when those words appear nowhere in the name.
      coalesce(array_to_string(p.services, ' '), '')        ILIKE '%' || search_term || '%' OR
      coalesce(array_to_string(p.specializations, ' '), '') ILIKE '%' || search_term || '%'
    )
  -- Area first so the directory can render locality headings straight off an
  -- ordered page, best-rated first within each.
  ORDER BY p.area NULLS LAST, p.rating DESC NULLS LAST, p.name
  LIMIT page_limit OFFSET page_offset;
$$;

GRANT EXECUTE ON FUNCTION search_providers(boolean, text, text, text, integer, integer)
  TO anon, authenticated;

-- ── Facets ───────────────────────────────────────────────────────────────────
-- Tab counts and the area dropdown need totals across the whole table, not just
-- the current page. Type counts respect the selected area so the tab badges
-- stay truthful when narrowed to one locality; the area list stays global so
-- the dropdown always offers every locality.

CREATE OR REPLACE FUNCTION provider_facets(
  approved_only boolean DEFAULT true,
  filter_area   text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', (
      SELECT count(*) FROM public.providers
      WHERE (NOT approved_only OR is_approved)
        AND (filter_area IS NULL OR area = filter_area)
    ),
    'types', coalesce((
      SELECT jsonb_object_agg(type, n) FROM (
        SELECT type, count(*) AS n FROM public.providers
        WHERE (NOT approved_only OR is_approved)
          AND type IS NOT NULL
          AND (filter_area IS NULL OR area = filter_area)
        GROUP BY type
      ) t
    ), '{}'::jsonb),
    'services', coalesce((
      SELECT jsonb_object_agg(svc, n) FROM (
        SELECT unnest(services) AS svc, count(*) AS n FROM public.providers
        WHERE (NOT approved_only OR is_approved)
          AND services IS NOT NULL
          AND (filter_area IS NULL OR area = filter_area)
        GROUP BY svc
      ) s
    ), '{}'::jsonb),
    'specializations', coalesce((
      SELECT jsonb_object_agg(spec, n) FROM (
        SELECT unnest(specializations) AS spec, count(*) AS n FROM public.providers
        WHERE (NOT approved_only OR is_approved)
          AND specializations IS NOT NULL
          AND (filter_area IS NULL OR area = filter_area)
        GROUP BY spec
      ) sp
    ), '{}'::jsonb),
    'areas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('area', area, 'count', n) ORDER BY n DESC, area)
      FROM (
        SELECT area, count(*) AS n FROM public.providers
        WHERE (NOT approved_only OR is_approved) AND area IS NOT NULL AND area <> ''
        GROUP BY area
      ) a
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION provider_facets(boolean, text) TO anon, authenticated;

-- Supporting indexes for the filters above.
CREATE INDEX IF NOT EXISTS providers_area_idx ON public.providers(area);
CREATE INDEX IF NOT EXISTS providers_type_idx ON public.providers(type);
