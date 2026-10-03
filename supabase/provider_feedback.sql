-- Provider feedback: APPLIED 2026-10-03. Safe to re-run.
--
-- RUN AFTER provider_accounts.sql, which creates provider_accounts and
-- email_is_mine().
--
-- A provider signed in at /business had no way to say anything to anyone. That
-- mattered most in exactly the place it was missing: a suspended account could
-- see that its access had been paused and could not ask why.
--
-- The existing `feedback` table already takes the message — the provider shell
-- shares auth.uid() with the pet app, so "Users can insert own feedback"
-- (auth.uid() = user_id) already passes. What it could not do is say WHICH
-- BUSINESS the message is about, which is the one thing an admin reading the
-- queue needs. Hence a column, not a new table.

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS feedback_provider_idx
  ON public.feedback(provider_id) WHERE provider_id IS NOT NULL;

-- ── "Do I have any account at this business?" ───────────────────────────────
--
-- is_provider_member() deliberately requires status='active'. This deliberately
-- does NOT, and that difference is the entire reason it exists: the first
-- person who needs to send feedback is a provider whose account has just been
-- suspended. Gating the appeal on being un-suspended would make the feature
-- useless to the only user who urgently needs it.
--
-- So this answers a weaker question — "is there a row here that is yours, in
-- any state?" — and is used ONLY to stamp provenance on a support message. It
-- must never be used to grant access to anything.

CREATE OR REPLACE FUNCTION public.is_provider_claimant(check_provider_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.provider_accounts pa
    WHERE pa.provider_id = check_provider_id
      AND auth.uid() IS NOT NULL
      AND (pa.user_id = auth.uid()
           OR (pa.user_id IS NULL AND public.email_is_mine(pa.email)))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_provider_claimant(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_provider_claimant(uuid) TO authenticated;
-- anon as well, for the reason rls_hardening.sql gives: a policy calling a
-- function the caller cannot execute hard-errors instead of failing closed.
GRANT  EXECUTE ON FUNCTION public.is_provider_claimant(uuid) TO anon;

-- ── The policy ──────────────────────────────────────────────────────────────
--
-- Replaces "Users can insert own feedback", keeping its existing clause
-- verbatim and adding one. A pet parent sends provider_id IS NULL and is
-- therefore governed by exactly the rule they were governed by before — this
-- must stay true, because the customer-facing FeedbackButton writes through
-- this policy and a regression here is silent.
--
-- The new clause stops a signed-in user attributing a complaint to a business
-- they have nothing to do with. Without it, provider_id would be an unverified
-- label an admin could not act on.

DROP POLICY IF EXISTS "Users can insert own feedback" ON public.feedback;
CREATE POLICY "Users can insert own feedback" ON public.feedback
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (provider_id IS NULL OR public.is_provider_claimant(provider_id))
  );

-- SELECT stays admin-only and is untouched: "Admin reads all feedback".

-- ── Verified ────────────────────────────────────────────────────────────────
--
-- `npm run test:sql`, assertions 45-52, 52/52 passing:
--
--   pet parent inserts feedback (provider_id null) .... allowed, unchanged
--   anonymous inserts feedback ....................... blocked
--   user inserts feedback as another user_id ......... blocked
--   is_provider_claimant() as anonymous .............. false, NOT an error
--   suspended user: is_provider_member() ............. false
--   suspended user: is_provider_claimant() ........... true  <- the point
--   SUSPENDED provider sends feedback ................ allowed
--   stranger attributes to that business ............. blocked
--
-- Re-checked on the LIVE project after applying, inside transactions that were
-- rolled back:
--
--   a real pet parent, provider_id null .............. allowed (the clause they
--                                                      were governed by before
--                                                      is unchanged)
--   suspended provider, their own business ........... allowed
--   another user attributing to that business ........ blocked, 42501
--
-- Applied with ALTER POLICY rather than DROP + CREATE. The drop-and-recreate
-- form timed out through the connector and, worse, would have left a window
-- with no INSERT policy on a customer-facing table. ALTER POLICY swaps the
-- expression in one statement with no such gap.
