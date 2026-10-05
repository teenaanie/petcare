-- Telling a crash apart from a fault the user was shown.
--
-- Run this in the Supabase SQL editor, after supabase/client_errors.sql.
--
-- Why it exists: until now only UNCAUGHT faults were ever reported, because
-- window.onerror was the only thing calling the reporter. An error a component
-- catches and renders in its own UI never fires it, so it left no row at all.
--
-- The case that proved it. PetSharing's getMembers() threw
--
--   ReferenceError: Can't find variable: supabase
--
-- every single time the share panel was opened -- a missing
-- `const supabase = await getSupabase()` left behind by the lazy-client
-- conversion. The component caught it and rendered it through its own
-- friendly() helper, so window.onerror never fired, errorReport.js was never
-- called, and client_errors held ZERO rows for a bug that broke the feature on
-- every open. It took a customer to find it. Meanwhile the reports that DID
-- arrive were a stale service worker and a stale chunk import: the minority.
--
-- Both kinds are now reported, so the table needs to say which is which. They
-- read differently: an uncaught fault is an outage, and a handled one is a
-- feature that is quietly broken for everyone who tries it.

ALTER TABLE public.client_errors
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'uncaught';

-- Rows written before this column existed were all uncaught by definition --
-- nothing else could reach the reporter -- so the default above is already the
-- truth for every one of them and there is no backfill to do.

-- A closed vocabulary, matching KINDS in src/lib/errorReport.js. The client
-- and the endpoint both clamp to these two already; this is the backstop for a
-- report arriving from an old cached bundle or from anyone who found the URL.
DO $$
BEGIN
  ALTER TABLE public.client_errors
    ADD CONSTRAINT client_errors_kind_chk CHECK (kind IN ('uncaught', 'handled'));
EXCEPTION
  WHEN duplicate_object THEN NULL;   -- already applied
END $$;

-- The grouped view the Errors tab reads has to carry `kind` through, or the
-- dashboard cannot tell the two apart. Postgres will not let CREATE OR REPLACE
-- change a function's OUT columns, so this drops and recreates it. The body is
-- otherwise identical to the one in supabase/client_errors.sql.
--
-- MIN(e.kind) rather than a per-row value because the grouping is by
-- fingerprint: the same fault could in principle arrive both ways, and
-- 'handled' sorts before 'uncaught', so a fault ever seen as a crash still
-- reads as 'handled' when it was also caught somewhere. That is the useful
-- reading -- it says there is a catch block in the path.
DROP FUNCTION IF EXISTS public.get_client_errors_for_admin(integer);

CREATE FUNCTION public.get_client_errors_for_admin(days integer DEFAULT 7)
RETURNS TABLE(
  fingerprint text, name text, message text, view text, kind text, build text,
  browser text, occurrences bigint, users_affected bigint,
  first_seen timestamptz, last_seen timestamptz, sample_stack text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    e.fingerprint,
    MIN(e.name)    AS name,
    MIN(e.message) AS message,
    MIN(e.view)    AS view,
    MIN(e.kind)    AS kind,
    MAX(e.build)   AS build,
    MIN(e.browser) AS browser,
    COUNT(*)::bigint                        AS occurrences,
    COUNT(DISTINCT e.user_id)::bigint       AS users_affected,
    MIN(e.created_at) AS first_seen,
    MAX(e.created_at) AS last_seen,
    MIN(e.stack)   AS sample_stack
  FROM public.client_errors e
  WHERE e.created_at >= now() - (GREATEST(days, 1) || ' days')::interval
    AND (public.is_admin() OR COALESCE(auth.role(), '') = 'service_role')
  GROUP BY e.fingerprint
  ORDER BY COUNT(*) DESC, MAX(e.created_at) DESC
  LIMIT 100;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_client_errors_for_admin(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_client_errors_for_admin(integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_client_errors_for_admin(integer) TO authenticated;
