-- Client-side error reporting.
--
-- Run this in the Supabase SQL editor.
--
-- Today a crash, a white screen or a hang in someone's browser leaves no trace
-- anywhere. The voice hang reported by a customer could only be diagnosed
-- because the SUCCESSFUL call left a row in api_usage and the failed one left
-- nothing: the cause was deduced from an absence. This table is so the next one
-- is a fact rather than a deduction.
--
-- What it holds is deliberately thin. The browser scrubs every report before
-- sending (src/lib/errorReport.js) and the endpoint scrubs again
-- (api/_lib/report-error.js): no addresses, no phone numbers, no ids, no query
-- strings, no tokens, and `view` is a closed vocabulary rather than free text.
-- Nothing here should ever identify a person or their animal.

CREATE TABLE IF NOT EXISTS public.client_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Null for a signed-out crash, which is a case worth keeping: a fault on the
  -- landing page is exactly the sort nobody would otherwise ever hear about.
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fingerprint text NOT NULL,
  name        text NOT NULL,
  message     text,
  stack       text,
  view        text,
  path        text,
  build       text,
  browser     text,
  online      boolean,
  occurred_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The two questions actually asked of this table: "what is breaking most" and
-- "what has broken since the last deploy".
CREATE INDEX IF NOT EXISTS client_errors_created_idx     ON public.client_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS client_errors_fingerprint_idx ON public.client_errors (fingerprint);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- Admins read. Nobody else sees anything: writes arrive through the endpoint
-- using the service key, which bypasses RLS, so there is no insert policy here
-- on purpose. A signed-in user cannot read, write or enumerate this table.
DROP POLICY IF EXISTS "admin_reads_client_errors" ON public.client_errors;
CREATE POLICY "admin_reads_client_errors" ON public.client_errors
  FOR SELECT USING (public.is_admin());

-- Grouped for the dashboard: one row per distinct fault, most frequent first.
-- Doing this in SQL rather than in the browser keeps the client from having to
-- pull every individual row to count them.
CREATE OR REPLACE FUNCTION public.get_client_errors_for_admin(days integer DEFAULT 7)
RETURNS TABLE(
  fingerprint text, name text, message text, view text, build text,
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

-- Keep 90 days. Error reports age out of usefulness quickly, and an unbounded
-- table on a 500 MB database is a slow leak. Run this whenever, or leave it.
-- DELETE FROM public.client_errors WHERE created_at < now() - interval '90 days';
