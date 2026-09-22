-- supabase/provider_search_fuzzy.sql
--
-- Applied as migrations `enable_pg_trgm` and `provider_search_tokens_and_typos`.
--
-- WHY. Somebody looked for a boarder and found nothing, with 140 approved
-- boarders in the table. The old search was a single `ILIKE '%term%'` against
-- each field, so it failed in two ordinary ways:
--
--   'border'    -> 0 hits.  One letter out and the whole directory vanishes.
--                           This is the spelling most people reach for.
--   'pet hotel' -> 0 hits.  Two words only matched as one contiguous string,
--                           so any phrasing that is not literally in the data
--                           returns nothing.
--
-- Neither told the user they had merely mistyped. An empty result reads as
-- "Pippy has no boarders", which is the worst possible answer here: it is both
-- wrong and discouraging.
--
-- WHAT CHANGED. The term is split into words, and a row matches only when
-- EVERY word matches (AND, not OR -- extra words must narrow the search, never
-- widen it). A word matches a row if it appears as a substring anywhere in the
-- row's searchable text, or, failing that, if it is close to some word in that
-- text by trigram similarity.
--
-- The two guards on the fuzzy branch are what keep it from turning into noise:
--
--   length(tok) >= 4    Short words are left exact. 'vet' is three letters and
--                       close to far too much; it still returns exactly what it
--                       did before.
--   similarity >= 0.45  Measured against the real cases:
--                         boarder ~ border   0.50  -> matches
--                         groomer ~ gromer   0.67  -> matches
--                         boarder ~ builder  0.23  -> does not
--
-- Ranking: with a search term, rows whose NAME contains the whole term sort
-- first, so a business you searched for by name is not buried under dozens of
-- category matches -- the add-a-provider panel only shows the top 8. With no
-- term the ordering is byte-for-byte what it was, so browsing is unchanged.
--
-- Cost: ~42ms for the worst case measured (three words, full scan, word-level
-- similarity) over 968 rows, behind a 300ms debounce. If the directory grows by
-- an order of magnitude, add a GIN trigram index on the concatenated text and
-- revisit -- 968 rows does not justify one yet.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Signature, defaults, return type, SECURITY DEFINER and grants are all
-- unchanged -- this is a drop-in replacement. `extensions` joins the
-- search_path so similarity() resolves inside a SECURITY DEFINER body.
CREATE OR REPLACE FUNCTION public.search_providers(
  approved_only boolean DEFAULT true,
  filter_type   text    DEFAULT NULL::text,
  filter_area   text    DEFAULT NULL::text,
  search_term   text    DEFAULT NULL::text,
  page_limit    integer DEFAULT 60,
  page_offset   integer DEFAULT 0)
RETURNS TABLE(provider jsonb, total_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH q AS (
    SELECT nullif(btrim(coalesce(search_term, '')), '') AS term
  ),
  toks AS (
    SELECT array(
      SELECT lower(t)
      FROM unnest(regexp_split_to_array(coalesce((SELECT term FROM q), ''), '\s+')) t
      WHERE btrim(t) <> ''
    ) AS t
  ),
  cand AS (
    SELECT p,
           lower(concat_ws(' ', p.name, p.area, p.city, p.address, p.type, p.description,
                 array_to_string(p.categories, ' '),
                 array_to_string(p.services, ' '),
                 array_to_string(p.specializations, ' '))) AS hay
    FROM public.providers p
    WHERE (NOT approved_only OR p.is_approved)
      AND (filter_type IS NULL OR p.type = filter_type)
      AND (filter_area IS NULL OR p.area = filter_area)
  )
  SELECT to_jsonb(c.p) AS provider, count(*) OVER() AS total_count
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
    (c.p).rating DESC NULLS LAST,
    (c.p).name
  LIMIT page_limit OFFSET page_offset;
$function$;

-- Measured before and after, whole directory, page_limit 100000:
--
--   term                  before  after
--   border                     0    140   <- the reported failure
--   gromer                     0    140
--   pet hotel                  0     20
--   dog boarding aundh         0      1
--   boarder                  140    140   unchanged
--   groomer                  140    140   unchanged
--   vet                      212    212   unchanged (3 letters, exact only)
--   aundh                     34     34   unchanged
--   kennel                    24     24   unchanged
--   pet                      758    758   unchanged
--   xyzzy / zzzz / qwer        0      0   no garbage matching
--   (no term)                965    965   browsing unchanged
--   approved_only=false      976    976   unchanged
