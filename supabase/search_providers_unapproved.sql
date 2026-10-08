-- Who may see a listing that has not been approved.
--
-- NOT YET APPLIED when written. Safe to re-run.
--
-- ── The hole ────────────────────────────────────────────────────────────────
--
-- search_providers() is SECURITY DEFINER and granted to `anon`, which is right:
-- it is how a signed-out pet parent browses the directory, and the providers
-- table's own policy (`is_approved = true OR is_admin()`) is deliberately
-- bypassed because the function is the published surface.
--
-- But `approved_only` is an ARGUMENT, and a caller chooses it. Passing false
-- returned every UNAPPROVED row — the review queue — to anybody who asked,
-- `anon` included, with to_jsonb(p) carrying the whole row:
--
--   select * from search_providers(false, null, null, 'Tailwaggers', 10, 0);
--   → name, phone, address AND the EMAIL the owner typed into the form.
--
-- A business that submits its details and waits for review has not published
-- them. The email is the worst of it: it is the address that business signs in
-- with, now readable by anyone who guesses their name.
--
-- Found while adding a public "is my business already listed?" lookup, by
-- asking what that lookup could be made to return.
--
-- ── The fix, and why it is shaped like this ─────────────────────────────────
--
-- Two rules, both inside the function so no caller can opt out:
--
--   1. A SIGNED-OUT caller only ever sees approved rows. `approved_only` is
--      forced true for them, whatever they passed.
--   2. An unapproved row returned to a signed-in NON-ADMIN has its `email`
--      removed. That path exists for one reason — a provider searching for
--      their own business to claim it — and finding your kennel does not
--      require being handed the address another business registered with.
--
-- Admins keep the whole row: the review queue is their job and they already
-- read `providers` directly through its own policy.
--
-- What does NOT change: the approved directory, which is published by design
-- and is what every pet-parent screen reads.

CREATE OR REPLACE FUNCTION public.search_providers(
  approved_only boolean DEFAULT true,
  filter_type   text    DEFAULT NULL,
  filter_area   text    DEFAULT NULL,
  search_term   text    DEFAULT NULL,
  page_limit    integer DEFAULT 60,
  page_offset   integer DEFAULT 0
)
RETURNS TABLE(provider jsonb, total_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  WITH me AS (
    SELECT auth.uid() IS NOT NULL AS signed_in,
           public.is_admin()      AS admin
  ),
  q AS (
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
    FROM public.providers p, me
    -- Approved rows always; an unapproved one only when the caller BOTH asked
    -- for them and is signed in. A signed-out caller passing approved_only =>
    -- false therefore gets the published directory, not the review queue.
    WHERE (p.is_approved OR (NOT approved_only AND me.signed_in))
      AND (filter_type IS NULL OR p.type = filter_type)
      AND (filter_area IS NULL OR p.area = filter_area)
  )
  SELECT
    CASE
      -- An unapproved row loses the owner's address for everyone but an admin.
      -- Claiming a listing needs its NAME and where it is, never the email
      -- somebody else registered with.
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
$$;

-- ── How this was checked ────────────────────────────────────────────────────
--
-- NOT in scripts/sql-harness: that harness carries the provider-platform
-- migrations and a Supabase-shaped stub, and search_providers() is in neither —
-- it also needs pg_trgm for similarity(), which the stub does not install.
-- Porting both to test one predicate would be a bigger, more fragile thing than
-- the fix.
--
-- So it was run against the live project, as the roles themselves, before and
-- after. Reproduce with `set local role anon` / `set local role authenticated`
-- plus a request.jwt.claims:
--
--   anon, approved_only => false, 'Tailwaggers Pet Supplies'
--     before: 1 row, including the owner's email
--     after:  0 rows
--
--   signed-in non-admin, approved_only => false, same term
--     after:  1 row, and `provider ? 'email'` is false
--     (so claiming still finds an unapproved listing, which is the one thing
--      that path exists for)
--
--   anon, approved_only => true, no term
--     before and after: 963 rows — the published directory is untouched
