-- Who has gone quiet, and who has already been asked about it.
--
-- Run this in the Supabase SQL editor.
--
-- ── Why "inactive" is not `last_sign_in_at` ─────────────────────────────────
--
-- The obvious reading is "nobody has signed in for a month". It is wrong here,
-- and the live data says so. One account last signed in 58 days ago and was
-- still creating records 13 days ago: Supabase refreshes a session's token
-- without touching `last_sign_in_at`, so somebody who stays signed in on their
-- phone looks dormant forever. Emailing that person "is everything alright?"
-- when they used the app a fortnight ago is worse than not writing at all.
--
-- The reverse happens too. Another account signed in 6 days ago but has
-- created nothing for 12, because signing in is not using it.
--
-- So activity is the MOST RECENT of three things:
--
--   1. `last_sign_in_at`      -- they came back
--   2. anything they created  -- they did something, across 16 tables
--   3. `created_at`           -- they at least joined, which floors the figure
--
-- (3) matters: without it, an account that signed up two months ago and never
-- returned has no timestamp at all and would drop out of the list entirely,
-- when it is the single most worth asking about.
--
-- ── What this cannot see ────────────────────────────────────────────────────
--
-- No table in this schema has an `updated_at`. Correcting a vaccination date
-- or editing a note leaves no trace, so somebody who only ever tidies existing
-- records reads as inactive. Reading is invisible too. Both push the list
-- towards false positives rather than missed cases, which is the safer way for
-- it to be wrong -- but it is why the email asks a question rather than
-- announcing a conclusion.

-- ── Who has been contacted ──────────────────────────────────────────────────
--
-- Without this the admin clicks twice and sends twice, and there is no way to
-- tell a first check-in from a fourth. This is the record, and the endpoint
-- reads it to refuse a repeat.

CREATE TABLE IF NOT EXISTS public.inactive_checkins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE, not SET NULL: once the account is gone, "we emailed
  -- this person" is about nobody and is not ours to keep.
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  -- Which admin sent it, for a two-admin future where "who contacted them?"
  -- is a real question.
  sent_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The address it actually went to, as resolved at send time. Kept because a
  -- user can change their email, and "we wrote to them" should say where.
  sent_to    text,
  -- 'never_used' or 'went_quiet': which message they were sent.
  kind       text,
  idle_days  integer
);

CREATE INDEX IF NOT EXISTS inactive_checkins_user_idx ON public.inactive_checkins (user_id, sent_at DESC);

ALTER TABLE public.inactive_checkins ENABLE ROW LEVEL SECURITY;

-- Admins read. No insert policy on purpose: the endpoint writes with the
-- service key, which bypasses RLS, so a signed-in user cannot fabricate a
-- "we already contacted them" row to suppress a real check-in.
DROP POLICY IF EXISTS "admin_reads_inactive_checkins" ON public.inactive_checkins;
CREATE POLICY "admin_reads_inactive_checkins" ON public.inactive_checkins
  FOR SELECT USING (public.is_admin());

-- ── The list ────────────────────────────────────────────────────────────────
--
-- One definition of "inactive", used by BOTH the admin screen and the endpoint
-- that sends the email. The endpoint re-derives from this same function rather
-- than trusting the browser's claim, so the two can never disagree about who
-- is eligible -- and so the endpoint cannot be talked into emailing somebody
-- who is perfectly active.

CREATE OR REPLACE FUNCTION public.get_inactive_users_for_admin(days integer DEFAULT 30)
RETURNS TABLE(
  id uuid, email text, phone text, created_at timestamptz,
  pet_count bigint, last_sign_in_at timestamptz, last_activity_at timestamptz,
  last_seen_at timestamptz, idle_days integer, kind text, contactable boolean,
  last_checkin_at timestamptz, checkin_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH act AS (
    -- Every table that can show a user did something. Child tables reach the
    -- owner through pets; the rest carry user_id directly.
             SELECT user_id AS uid, max(created_at) AS t FROM public.pets               GROUP BY 1
    UNION ALL SELECT user_id,        max(created_at)      FROM public.api_usage          GROUP BY 1
    UNION ALL SELECT user_id,        max(created_at)      FROM public.client_errors      WHERE user_id IS NOT NULL GROUP BY 1
    UNION ALL SELECT user_id,        max(created_at)      FROM public.feedback           WHERE user_id IS NOT NULL GROUP BY 1
    UNION ALL SELECT user_id,        max(created_at)      FROM public.pet_members        GROUP BY 1
    UNION ALL SELECT user_id,        max(created_at)      FROM public.push_subscriptions GROUP BY 1
    UNION ALL SELECT user_id,        max(created_at)      FROM public.user_providers     GROUP BY 1
    UNION ALL SELECT p.user_id, max(c.created_at) FROM public.medical_records c JOIN public.pets p ON p.id = c.pet_id GROUP BY 1
    UNION ALL SELECT p.user_id, max(c.created_at) FROM public.vaccinations    c JOIN public.pets p ON p.id = c.pet_id GROUP BY 1
    UNION ALL SELECT p.user_id, max(c.created_at) FROM public.reminders       c JOIN public.pets p ON p.id = c.pet_id GROUP BY 1
    UNION ALL SELECT p.user_id, max(c.created_at) FROM public.weight_logs     c JOIN public.pets p ON p.id = c.pet_id GROUP BY 1
    UNION ALL SELECT p.user_id, max(c.created_at) FROM public.medicines       c JOIN public.pets p ON p.id = c.pet_id GROUP BY 1
    UNION ALL SELECT p.user_id, max(c.created_at) FROM public.bills           c JOIN public.pets p ON p.id = c.pet_id GROUP BY 1
    UNION ALL SELECT p.user_id, max(c.created_at) FROM public.allergies       c JOIN public.pets p ON p.id = c.pet_id GROUP BY 1
    UNION ALL SELECT p.user_id, max(c.created_at) FROM public.boarding_trips  c JOIN public.pets p ON p.id = c.pet_id GROUP BY 1
    UNION ALL SELECT p.user_id, max(c.created_at) FROM public.conditions      c JOIN public.pets p ON p.id = c.pet_id GROUP BY 1
  ),
  rolled AS (
    SELECT
      u.id, u.email::text AS email, u.phone::text AS phone, u.created_at,
      u.last_sign_in_at,
      max(a.t) AS last_activity_at,
      -- GREATEST ignores NULLs, and created_at is NOT NULL, so this is never
      -- NULL -- which is what keeps a never-returned signup in the list.
      GREATEST(u.last_sign_in_at, max(a.t), u.created_at) AS last_seen_at
    FROM auth.users u
    LEFT JOIN act a ON a.uid = u.id
    GROUP BY u.id, u.email, u.phone, u.created_at, u.last_sign_in_at
  )
  SELECT
    r.id, r.email, r.phone, r.created_at,
    (SELECT count(*) FROM public.pets p WHERE p.user_id = r.id)::bigint AS pet_count,
    r.last_sign_in_at, r.last_activity_at, r.last_seen_at,
    EXTRACT(DAY FROM (now() - r.last_seen_at))::integer AS idle_days,
    -- Two different conversations. Somebody who never added a pet got stuck
    -- somewhere in setup; somebody who used it for a while and stopped has a
    -- different reason, and asking the wrong question wastes the message.
    CASE WHEN r.last_activity_at IS NULL THEN 'never_used' ELSE 'went_quiet' END AS kind,
    -- Phone-only accounts are real and cannot be emailed. They are listed
    -- anyway, flagged, because hiding them would quietly shrink the problem.
    (r.email IS NOT NULL AND r.email <> '') AS contactable,
    (SELECT max(c.sent_at)  FROM public.inactive_checkins c WHERE c.user_id = r.id) AS last_checkin_at,
    (SELECT count(*)::integer FROM public.inactive_checkins c WHERE c.user_id = r.id) AS checkin_count
  FROM rolled r
  WHERE (public.is_admin() OR COALESCE(auth.role(), '') = 'service_role')
    AND r.last_seen_at < now() - (GREATEST(days, 1) || ' days')::interval
    -- Staff are not customers. An admin going quiet is not a support case, and
    -- this also stops the screen offering to email you about yourself.
    AND NOT EXISTS (
      SELECT 1 FROM public.admins ad
      WHERE ad.revoked_at IS NULL
        AND (ad.user_id = r.id OR (ad.user_id IS NULL AND lower(ad.email) = lower(r.email)))
    )
  ORDER BY r.last_seen_at ASC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_inactive_users_for_admin(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_inactive_users_for_admin(integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_inactive_users_for_admin(integer) TO authenticated;
