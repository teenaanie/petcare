-- Usage metering: what Pippy costs and how much room is left.
--
-- Run this in the Supabase SQL editor. It does four things:
--   1. Caps the size of a pet photo at the database, not just in the browser
--   2. Adds usage_snapshots, one row per day, so there is a trend to look at
--   3. Adds get_usage_metrics_for_admin(), the live numbers for the dashboard
--   4. Locks both down to admins and the service key
--
-- Nothing here touches or reads anyone's pet records.

-- ── 1. A real limit on pet photos ───────────────────────────────────────────
--
-- pets.photo holds a base64 data URL, so a photo counts against the 500 MB
-- DATABASE limit rather than the 1 GB storage limit, and every query that
-- selects a pet carries the whole image with it.
--
-- The browser already shrinks images to 300px, but that is a convenience and
-- not a limit: the table is reachable with the anon key and a signed-in user's
-- JWT, so anything could be written into this column. This is the only place
-- the size is actually enforced.
--
-- 150000 characters of base64 is roughly a 110 kB image. The largest photo in
-- the table today is 34 kB, so nothing existing is affected; this exists to
-- stop the pathological case, not to trim normal use.

ALTER TABLE public.pets DROP CONSTRAINT IF EXISTS pets_photo_size;
ALTER TABLE public.pets ADD CONSTRAINT pets_photo_size
  CHECK (photo IS NULL OR length(photo) <= 150000);

-- ── 2. Daily snapshots ──────────────────────────────────────────────────────
--
-- Taken once a day by /api/usage-report. Daily rather than weekly because the
-- rows are tiny and a daily series can always be rolled up to weeks, while a
-- weekly series cannot be broken back down. It also gives the alerting
-- something to compare today against.

CREATE TABLE IF NOT EXISTS public.usage_snapshots (
  day                 date PRIMARY KEY,
  openai_cost_mtd_usd numeric(10,4) NOT NULL DEFAULT 0,
  openai_calls_mtd    integer       NOT NULL DEFAULT 0,
  db_bytes            bigint        NOT NULL DEFAULT 0,
  storage_bytes       bigint        NOT NULL DEFAULT 0,
  photo_bytes         bigint        NOT NULL DEFAULT 0,
  users_total         integer       NOT NULL DEFAULT 0,
  pets_total          integer       NOT NULL DEFAULT 0,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.usage_snapshots ENABLE ROW LEVEL SECURITY;

-- Admins read. Nobody else sees it, and writes come from the service key,
-- which bypasses RLS.
DROP POLICY IF EXISTS "admin_reads_usage_snapshots" ON public.usage_snapshots;
CREATE POLICY "admin_reads_usage_snapshots" ON public.usage_snapshots
  FOR SELECT USING (public.is_admin());

-- ── 3. The live numbers ─────────────────────────────────────────────────────
--
-- pg_database_size and storage.objects are not readable by an ordinary signed-in
-- user, so this is SECURITY DEFINER. The same admin-or-service-key gate as
-- get_all_users_for_admin: is_admin() covers the dashboard, auth.role() covers
-- the scheduled job, where auth.uid() is null.
--
-- It returns totals only. No per-user figures, no email addresses, nothing that
-- identifies whose photo or whose API call contributed.

CREATE OR REPLACE FUNCTION public.get_usage_metrics_for_admin()
RETURNS TABLE(
  openai_cost_mtd_usd numeric,
  openai_calls_mtd    bigint,
  openai_cost_all_usd numeric,
  db_bytes            bigint,
  storage_bytes       bigint,
  photo_bytes         bigint,
  users_total         bigint,
  pets_total          bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE((SELECT SUM(estimated_cost_usd) FROM public.api_usage
              WHERE created_at >= date_trunc('month', now())), 0)::numeric,
    COALESCE((SELECT COUNT(*) FROM public.api_usage
              WHERE created_at >= date_trunc('month', now())), 0)::bigint,
    COALESCE((SELECT SUM(estimated_cost_usd) FROM public.api_usage), 0)::numeric,
    pg_database_size(current_database())::bigint,
    COALESCE((SELECT SUM((metadata->>'size')::bigint) FROM storage.objects), 0)::bigint,
    COALESCE((SELECT SUM(length(photo)) FROM public.pets), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM auth.users), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM public.pets), 0)::bigint
  WHERE public.is_admin() OR COALESCE(auth.role(), '') = 'service_role';
$function$;

REVOKE EXECUTE ON FUNCTION public.get_usage_metrics_for_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_usage_metrics_for_admin() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_usage_metrics_for_admin() TO authenticated;

-- A non-admin gets zero rows rather than an error, which is why the dashboard
-- treats "no row" as "not permitted" rather than "no data".
