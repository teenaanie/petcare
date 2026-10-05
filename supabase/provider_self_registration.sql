-- Register-and-claim in one step: APPLIED 2026-10-05. Safe to re-run.
--
-- RUN AFTER provider_accounts.sql.
--
-- A business whose listing Google never captured used to fall down a hole. At
-- /business they signed in, searched, found nothing, and were sent to
-- /register-provider to fill an anonymous form, wait for the LISTING to be
-- approved, come back, search again, claim, and wait for the ACCOUNT to be
-- approved. Two forms, two waits, two approvals, and a bounce in the middle
-- where nothing recorded that they had been there at all. Drop off at that
-- bounce and all that remained was an orphan auth.users row: no business name,
-- nothing in the Claims queue, no sign they ever tried.
--
-- So the hole becomes the capture point. register_and_claim_provider() creates
-- the listing and the claim together, for a caller who is already signed in,
-- which means their address is on the claim from the first second.
--
-- IMPORTANT, and the reason the caller's email is not written to `providers`:
-- search_providers() returns to_jsonb(p) and is granted to anon, so every
-- column on that table is world-readable to anyone holding the public key. The
-- person's address belongs on provider_accounts, which is not. This is the same
-- warning provider_accounts.sql opens with; do not undo it here.

-- ── Create the listing and claim it, atomically ─────────────────────────────

CREATE OR REPLACE FUNCTION public.register_and_claim_provider(
  p_name text,
  p_type text,
  p_phone text,
  p_area text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_whatsapp text DEFAULT NULL,
  p_hours text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_maps_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  new_provider_id uuid;
  new_account_id  uuid;
  pending_count   int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Please enter a business name';
  END IF;
  IF coalesce(btrim(p_phone), '') = '' THEN
    RAISE EXCEPTION 'Please enter a phone number';
  END IF;
  -- The vocabulary is the one in src/lib/taxonomy.js. An unknown type would
  -- otherwise sit in the directory as a category nothing filters on.
  IF p_type IS NULL OR p_type NOT IN (
    'Vet','Groomer','Store','Boarder','Dog Walking','Training',
    'Pet Sitting','Special Services','Pet Loss & Memorial Services'
  ) THEN
    RAISE EXCEPTION 'Please choose what kind of business this is';
  END IF;

  -- Anyone signed in can reach this, so it needs a ceiling. Three pending
  -- claims is more than a real business ever has and little enough that a
  -- bored visitor cannot fill the review queue.
  SELECT count(*) INTO pending_count
  FROM public.provider_accounts
  WHERE user_id = auth.uid() AND status = 'pending';
  IF pending_count >= 3 THEN
    RAISE EXCEPTION 'You already have % claims waiting for review. We will get to them before you can add another.', pending_count;
  END IF;

  -- maps_url is the owner's data elsewhere in this schema and is never tidied;
  -- here it is new input, so reject nonsense rather than store it.
  IF p_maps_url IS NOT NULL AND btrim(p_maps_url) <> ''
     AND p_maps_url !~* '^https?://' THEN
    RAISE EXCEPTION 'That does not look like a link';
  END IF;

  INSERT INTO public.providers (
    name, type, phone, area, city, address, whatsapp, hours, description,
    maps_url, is_approved, source
  ) VALUES (
    btrim(p_name), p_type, btrim(p_phone),
    nullif(btrim(coalesce(p_area, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_whatsapp, '')), ''),
    nullif(btrim(coalesce(p_hours, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_maps_url, '')), ''),
    false, 'self_registered'
  )
  RETURNING id INTO new_provider_id;

  INSERT INTO public.provider_accounts (
    provider_id, user_id, email, status, claimed_type, claim_note
  ) VALUES (
    new_provider_id, auth.uid(), public.current_user_email(), 'pending', p_type,
    'Added their own listing from the business sign-in.'
  )
  RETURNING id INTO new_account_id;

  RETURN new_account_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_and_claim_provider(text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_and_claim_provider(text,text,text,text,text,text,text,text,text,text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.register_and_claim_provider(text,text,text,text,text,text,text,text,text,text) TO authenticated;

-- ── Approve the claim and publish the listing, atomically ───────────────────
--
-- The owner's ruling is one decision rather than two: approving a claim on a
-- self-registered business also publishes it. Doing that as two client-side
-- updates would leave a real failure mode — the account active and the listing
-- still invisible, with nothing saying so — so it is one function.
--
-- A claim on a listing Google already gave us is the ordinary case and needs no
-- publishing; is_approved is already true and this leaves it alone.

CREATE OR REPLACE FUNCTION public.approve_provider_claim(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  target_provider uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  UPDATE public.provider_accounts
  SET status = 'active', granted_by = auth.uid(), granted_at = now(), revoked_at = NULL
  WHERE id = p_account_id
  RETURNING provider_id INTO target_provider;

  IF target_provider IS NULL THEN
    RAISE EXCEPTION 'No such claim';
  END IF;

  UPDATE public.providers
  SET is_approved = true
  WHERE id = target_provider AND is_approved = false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_provider_claim(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_provider_claim(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.approve_provider_claim(uuid) TO authenticated;

-- admin_provider_claims() gained provider_is_approved and provider_source so
-- this queue can show what approving will publish. That function lives in
-- provider_accounts.sql, which owns it — defining it in two files meant the
-- second run of the pair tried to change a return type that the first had
-- already changed, and failed. One function, one home.

-- ── Verify before trusting this ─────────────────────────────────────────────
--
-- Covered by `npm run test:sql`. Recorded here on apply.
--
--   anonymous calls register_and_claim_provider() .... blocked
--   signed-in user registers and claims .............. one providers row
--                                                      (is_approved false) and
--                                                      one pending claim
--   the claim carries their email .................... true
--   a blank name / blank phone / unknown type ........ blocked
--   a fourth pending claim ........................... blocked
--   non-admin calls approve_provider_claim() ......... blocked
--   admin approves .................................. account active AND
--                                                      listing published
--   admin approves a Google-sourced claim ............ listing left alone
--   admin_provider_claims() shows is_approved ...... true
--
-- Re-checked on the LIVE project after applying, inside transactions that were
-- rolled back. providers is back at 976 rows with 0 self_registered and 0
-- claims afterwards:
--
--   register_and_claim_provider() as a real user ..... listing created
--                                                      is_approved=false,
--                                                      source=self_registered;
--                                                      claim pending
--   is_provider_member() while pending ............... false
--   admin sees it in admin_provider_claims() ......... 1 row,
--                                                      provider_is_approved=false
--   approve_provider_claim() as the admin ............ account active, listing
--                                                      is_approved=true,
--                                                      is_provider_member() true
--
-- A note on how this was applied, because it shaped the design. Every statement
-- containing DROP timed out through the Supabase connector used here, while
-- everything else went through in under a second. That is why the review-queue
-- function was RENAMED (admin_provider_accounts -> admin_provider_claims) in
-- provider_accounts.sql rather than dropped and recreated with its new columns:
-- a rename needs no DROP, and it also removes the underlying trap, since
-- CREATE OR REPLACE can never change a function's return type. The old function
-- is still live and unused; the DROP at the foot of provider_accounts.sql
-- clears it whenever that file is next run in the SQL editor.
