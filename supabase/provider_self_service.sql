-- A provider editing their own listing, and their own boarding criteria.
--
-- NOT YET APPLIED when written. Phase 10. Safe to re-run.
--
-- ── Why functions and not a policy ──────────────────────────────────────────
--
-- `providers` is admin-write and world-read-when-approved. The obvious move is
-- an UPDATE policy for is_provider_member(id) — and it is wrong, because RLS
-- cannot restrict WHICH COLUMNS a row update touches. Supabase grants UPDATE on
-- every column to `authenticated` by default and relies on RLS for the row, so
-- a row-level policy here would let a claimant set `is_approved`, rewrite
-- `type`, or overwrite `place_id`, `categories` and `maps_url` — the scraped
-- facts that are the owner's data, not the business's.
--
-- Two SECURITY DEFINER functions instead, with the writable columns written out
-- by hand. What a provider may change is then a list in one place that can be
-- read in ten seconds, rather than the absence of a restriction.
--
-- ── What a provider may and may not change ──────────────────────────────────
--
--   MAY    phone, whatsapp, email, hours, address, area, website, description,
--          and their boarding criteria.
--   MAY NOT  name, type, is_approved, place_id, maps_url, categories, lat/lng,
--            rating, reviews_count, source.
--
-- `name` and `type` are out deliberately and it is not an oversight. The name
-- is how a pet parent recognises the business they were recommended, and the
-- type decides which tab it appears under; a claimant quietly renaming a
-- claimed listing is how one business becomes another. Both are a message to a
-- human, and provider_feedback already carries one.
--
-- ── Why reading needs a function too ────────────────────────────────────────
--
-- The SELECT policy is `is_approved = true OR is_admin()`. A business whose
-- listing is not published — a fresh self-registration, or a demo account —
-- cannot read its own row at all, so the edit form would open empty and save
-- over nothing. my_provider_details() answers with the same membership test the
-- rest of the provider shell uses.

CREATE OR REPLACE FUNCTION public.my_provider_details(p_provider_id uuid)
RETURNS TABLE (
  id uuid, name text, type text, area text, city text, address text,
  phone text, whatsapp text, email text, website text, hours text,
  description text, is_approved boolean, boarding_policy jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.name, p.type, p.area, p.city, p.address,
         p.phone, p.whatsapp, p.email, p.website, p.hours,
         p.description, p.is_approved, p.boarding_policy
  FROM public.providers p
  WHERE p.id = p_provider_id
    AND public.is_provider_member(p.id);
$$;

REVOKE ALL ON FUNCTION public.my_provider_details(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.my_provider_details(uuid) TO authenticated;

-- ── Saving ──────────────────────────────────────────────────────────────────
--
-- Every argument defaults to NULL and NULL means "leave it alone", so a caller
-- that knows about six fields cannot blank the seventh it has never heard of.
-- Clearing a field is done by passing an empty string, which lands as NULL.

CREATE OR REPLACE FUNCTION public.update_my_provider(
  p_provider_id uuid,
  p_phone       text DEFAULT NULL,
  p_whatsapp    text DEFAULT NULL,
  p_email       text DEFAULT NULL,
  p_website     text DEFAULT NULL,
  p_hours       text DEFAULT NULL,
  p_address     text DEFAULT NULL,
  p_area        text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  blank CONSTANT text := '';
BEGIN
  IF NOT public.is_provider_member(p_provider_id) THEN
    RAISE EXCEPTION 'Not your business';
  END IF;

  UPDATE public.providers SET
    phone       = CASE WHEN p_phone       IS NULL THEN phone
                       WHEN btrim(p_phone) = blank THEN NULL ELSE btrim(p_phone) END,
    whatsapp    = CASE WHEN p_whatsapp    IS NULL THEN whatsapp
                       WHEN btrim(p_whatsapp) = blank THEN NULL ELSE btrim(p_whatsapp) END,
    email       = CASE WHEN p_email       IS NULL THEN email
                       WHEN btrim(p_email) = blank THEN NULL ELSE btrim(p_email) END,
    website     = CASE WHEN p_website     IS NULL THEN website
                       WHEN btrim(p_website) = blank THEN NULL ELSE btrim(p_website) END,
    hours       = CASE WHEN p_hours       IS NULL THEN hours
                       WHEN btrim(p_hours) = blank THEN NULL ELSE btrim(p_hours) END,
    address     = CASE WHEN p_address     IS NULL THEN address
                       WHEN btrim(p_address) = blank THEN NULL ELSE btrim(p_address) END,
    area        = CASE WHEN p_area        IS NULL THEN area
                       WHEN btrim(p_area) = blank THEN NULL ELSE btrim(p_area) END,
    description = CASE WHEN p_description IS NULL THEN description
                       WHEN btrim(p_description) = blank THEN NULL ELSE btrim(p_description) END
  WHERE id = p_provider_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_provider(uuid, text, text, text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.update_my_provider(uuid, text, text, text, text, text, text, text, text) TO authenticated;

-- ── Boarding criteria ───────────────────────────────────────────────────────
--
-- Separate from the details above because it is a different act with a
-- different audience: these criteria are what a PET PARENT reads on the
-- Boarding tab before they travel, through resolvePolicy() in
-- src/lib/boarding.js. A boarder was previously unable to state their own
-- requirements — an admin typed them in on their behalf, which does not scale
-- past a handful of businesses and leaves every other listing on the generic
-- list.
--
-- jsonb straight through, because the policy's shape belongs to boarding.js and
-- is already versioned there; a column per requirement would mean a migration
-- every time a boarder asks for something new. The one thing enforced is that
-- it is an OBJECT: a bare array or string would break resolvePolicy's spread
-- and take out the pet-parent Boarding tab for everyone who reads that row.

CREATE OR REPLACE FUNCTION public.update_my_boarding_policy(
  p_provider_id uuid,
  p_policy      jsonb
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_provider_member(p_provider_id) THEN
    RAISE EXCEPTION 'Not your business';
  END IF;
  IF p_policy IS NOT NULL AND jsonb_typeof(p_policy) <> 'object' THEN
    RAISE EXCEPTION 'A boarding policy must be an object';
  END IF;

  UPDATE public.providers SET boarding_policy = p_policy WHERE id = p_provider_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_boarding_policy(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_my_boarding_policy(uuid, jsonb) TO authenticated;

-- ── Boundary tests ──────────────────────────────────────────────────────────
--
-- Run by scripts/sql-harness/run.sh (npm run test:sql). What they pin:
--
--   a business reads its own UNAPPROVED listing ........... 1 row
--   a different business reads it ........................ 0 rows
--   a suspended claimant reads it ........................ 0 rows
--   a business edits its own phone ....................... works
--   a different business edits it ........................ raises
--   a suspended claimant edits it ........................ raises
--   NULL leaves a field alone ............................ unchanged
--   an empty string clears it ............................ null
--   the type and approval are untouched by any of it ..... unchanged
--   a boarding policy is saved and read back ............. round trips
--   a policy that is not an object ....................... raises
