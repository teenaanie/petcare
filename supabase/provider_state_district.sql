-- State and district on providers, and a search that can filter by them.
--
-- Run this in the Supabase SQL editor.
--
-- The directory has only ever held one city. Every one of the 983 providers is
-- in Pune: 970 rows say "Pune" exactly and the other 13 are scrape artifacts
-- of the same place ("Khadewadi, Pune", "SchoolPune, Pune"). Area is the only
-- geography that does any work, with 104 distinct values.
--
-- That stops being enough the moment a second state is added, because "Kothrud"
-- means nothing without "Pune", and "Pune" means nothing without
-- "Maharashtra". So the hierarchy becomes state -> district -> area, which is
-- how Indian addresses are actually organised.
--
-- District rather than city on purpose: Pimpri-Chinchwad is its own city but
-- sits in Pune district, and somebody searching Pune expects to find it.

-- ── 1. The columns ──────────────────────────────────────────────────────────

ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS state    text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS district text;

-- The directory filters state first, then district, so this is the order the
-- index wants.
CREATE INDEX IF NOT EXISTS providers_state_district_idx
  ON public.providers (state, district);

-- ── 2. Backfill ─────────────────────────────────────────────────────────────
--
-- Every existing row is in Pune district, Maharashtra. That is not an
-- assumption: `city` is "Pune" or a mangled variant of it on all 983 rows, and
-- the two Pimpri-Chinchwad rows are in Pune district too.
--
-- Only NULLs are touched, so running this twice is safe and nothing already
-- set by hand is overwritten.

UPDATE public.providers
   SET state = 'Maharashtra'
 WHERE state IS NULL;

UPDATE public.providers
   SET district = 'Pune'
 WHERE district IS NULL;

-- ── 3. search_providers ─────────────────────────────────────────────────────
--
-- DROP first, deliberately. CREATE OR REPLACE with a different argument list
-- does not replace a function in Postgres -- it creates an OVERLOAD. Two
-- overloads both reachable by name is an ambiguous call, and PostgREST would
-- start failing with "could not choose a best candidate function". The old
-- signature has to go.

DROP FUNCTION IF EXISTS public.search_providers(boolean, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.search_providers(
  approved_only   boolean DEFAULT true,
  filter_type     text    DEFAULT NULL,
  filter_area     text    DEFAULT NULL,
  search_term     text    DEFAULT NULL,
  page_limit      integer DEFAULT 60,
  page_offset     integer DEFAULT 0,
  filter_state    text    DEFAULT NULL,
  filter_district text    DEFAULT NULL
)
RETURNS TABLE(provider jsonb, total_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH me AS (
    SELECT auth.uid() IS NOT NULL AS signed_in, public.is_admin() AS admin
  ),
  q AS (SELECT nullif(btrim(coalesce(search_term, '')), '') AS term),
  toks AS (
    SELECT array(
      SELECT lower(t)
      FROM unnest(regexp_split_to_array(coalesce((SELECT term FROM q), ''), '\s+')) t
      WHERE btrim(t) <> ''
    ) AS t
  ),
  cand AS (
    SELECT p,
           -- State and district join the haystack, so typing "Maharashtra" or
           -- "Pune" finds things the same way typing an area already does.
           lower(concat_ws(' ', p.name, p.area, p.city, p.district, p.state, p.address,
                 p.type, p.description,
                 array_to_string(p.categories, ' '),
                 array_to_string(p.services, ' '),
                 array_to_string(p.specializations, ' '))) AS hay
    FROM public.providers p, me
    WHERE (p.is_approved OR (NOT approved_only AND me.signed_in))
      AND (filter_type     IS NULL OR p.type     = filter_type)
      AND (filter_area     IS NULL OR p.area     = filter_area)
      -- A row with no state set is not hidden by a state filter. Rows arrive
      -- from scrapes and registrations that may not carry one yet, and a
      -- provider nobody can find is worse than one filed loosely.
      AND (filter_state    IS NULL OR p.state    = filter_state    OR p.state    IS NULL)
      AND (filter_district IS NULL OR p.district = filter_district OR p.district IS NULL)
  )
  SELECT
    CASE
      WHEN (c.p).is_approved OR (SELECT admin FROM me) THEN to_jsonb(c.p)
      ELSE to_jsonb(c.p) - 'email'
    END AS provider,
    count(*) OVER() AS total_count
  FROM cand c, toks, q
  WHERE cardinality(toks.t) = 0
     OR NOT EXISTS (
          SELECT 1 FROM unnest(toks.t) tok
          WHERE position(tok IN c.hay) = 0
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(regexp_split_to_array(c.hay, '\s+')) w
              WHERE length(tok) >= 4 AND similarity(w, tok) >= 0.45
            )
        )
  ORDER BY
    CASE WHEN q.term IS NULL THEN 0
         WHEN position(lower(q.term) IN lower((c.p).name)) > 0 THEN 0
         ELSE 1 END,
    (c.p).area NULLS LAST,
    (c.p).name
  LIMIT page_limit OFFSET page_offset;
$function$;

-- ── 4. provider_facets ──────────────────────────────────────────────────────
--
-- Same reason for the DROP.

DROP FUNCTION IF EXISTS public.provider_facets(boolean, text);

CREATE OR REPLACE FUNCTION public.provider_facets(
  approved_only   boolean DEFAULT true,
  filter_area     text    DEFAULT NULL,
  filter_state    text    DEFAULT NULL,
  filter_district text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH scoped AS (
    SELECT * FROM public.providers
    WHERE (NOT approved_only OR is_approved)
      AND (filter_state    IS NULL OR state    = filter_state    OR state    IS NULL)
      AND (filter_district IS NULL OR district = filter_district OR district IS NULL)
  )
  SELECT jsonb_build_object(
    'total', (
      SELECT count(*) FROM scoped
      WHERE (filter_area IS NULL OR area = filter_area)
    ),
    'types', coalesce((
      SELECT jsonb_object_agg(type, n) FROM (
        SELECT type, count(*) AS n FROM scoped
        WHERE type IS NOT NULL AND (filter_area IS NULL OR area = filter_area)
        GROUP BY type
      ) t
    ), '{}'::jsonb),
    'services', coalesce((
      SELECT jsonb_object_agg(svc, n) FROM (
        SELECT unnest(services) AS svc, count(*) AS n FROM scoped
        WHERE services IS NOT NULL AND (filter_area IS NULL OR area = filter_area)
        GROUP BY svc
      ) s
    ), '{}'::jsonb),
    'specializations', coalesce((
      SELECT jsonb_object_agg(spec, n) FROM (
        SELECT unnest(specializations) AS spec, count(*) AS n FROM scoped
        WHERE specializations IS NOT NULL AND (filter_area IS NULL OR area = filter_area)
        GROUP BY spec
      ) sp
    ), '{}'::jsonb),
    -- Areas are scoped to the chosen state and district, which is the whole
    -- point: picking Karnataka must not leave Kothrud in the place list.
    'areas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('area', area, 'count', n) ORDER BY n DESC, area)
      FROM (
        SELECT area, count(*) AS n FROM scoped
        WHERE area IS NOT NULL AND area <> ''
        GROUP BY area
      ) a
    ), '[]'::jsonb),
    -- The two new lists the directory's dropdowns are built from. Districts
    -- are scoped to the chosen state for the same reason.
    'states', coalesce((
      SELECT jsonb_agg(jsonb_build_object('state', state, 'count', n) ORDER BY n DESC, state)
      FROM (
        SELECT state, count(*) AS n FROM public.providers
        WHERE (NOT approved_only OR is_approved) AND state IS NOT NULL AND state <> ''
        GROUP BY state
      ) st
    ), '[]'::jsonb),
    'districts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('district', district, 'count', n) ORDER BY n DESC, district)
      FROM (
        SELECT district, count(*) AS n FROM public.providers
        WHERE (NOT approved_only OR is_approved)
          AND district IS NOT NULL AND district <> ''
          AND (filter_state IS NULL OR state = filter_state OR state IS NULL)
        GROUP BY district
      ) d
    ), '[]'::jsonb)
  );
$function$;

-- Same grants the originals carried.
REVOKE EXECUTE ON FUNCTION public.search_providers(boolean, text, text, text, integer, integer, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.search_providers(boolean, text, text, text, integer, integer, text, text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.provider_facets(boolean, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.provider_facets(boolean, text, text, text) TO anon, authenticated;

-- ── After running this ──────────────────────────────────────────────────────
--
-- Check it took:
--
--   SELECT state, district, count(*) FROM public.providers GROUP BY 1,2;
--     -> Maharashtra | Pune | 983
--
--   SELECT jsonb_pretty(public.provider_facets(true, NULL, NULL, NULL) -> 'states');
--     -> [{"state": "Maharashtra", "count": 983}]
