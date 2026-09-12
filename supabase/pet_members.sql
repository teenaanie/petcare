-- Pet sharing: run this in your Supabase SQL editor (safe to re-run).
-- Creates pet_members, then wires every pet-scoped table so that:
--   • owners always have full access
--   • viewers can SELECT records for pets shared with them
--   • editors can SELECT + INSERT + UPDATE records for pets shared with them

-- ── pet_members table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pet_members (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_id     uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  role       text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  created_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE pet_members
    ADD CONSTRAINT pet_members_pet_email_unique UNIQUE (pet_id, email);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS pet_members_pet_id_idx  ON pet_members(pet_id);
CREATE INDEX IF NOT EXISTS pet_members_user_id_idx ON pet_members(user_id);
CREATE INDEX IF NOT EXISTS pet_members_email_idx   ON pet_members(email);

ALTER TABLE pet_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pet_owner_manage_members" ON pet_members;
CREATE POLICY "pet_owner_manage_members" ON pet_members
  FOR ALL USING (
    pet_id IN (SELECT id FROM pets WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "member_see_own_row" ON pet_members;
CREATE POLICY "member_see_own_row" ON pet_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- ── Helper functions ───────────────────────────────────────────────────────
-- SECURITY DEFINER so they can read auth.users / pet_members regardless of
-- the calling role's own RLS visibility into those tables.

CREATE OR REPLACE FUNCTION is_pet_member(check_pet_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM pets WHERE id = check_pet_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM pet_members
    WHERE pet_id = check_pet_id
      AND (user_id = auth.uid() OR email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
$$;

CREATE OR REPLACE FUNCTION is_pet_editor(check_pet_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM pets WHERE id = check_pet_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM pet_members
    WHERE pet_id = check_pet_id AND role = 'editor'
      AND (user_id = auth.uid() OR email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  );
$$;

-- ── pets table: shared SELECT + editor INSERT/UPDATE ───────────────────────

DROP POLICY IF EXISTS "Users can view own pets" ON pets;
DROP POLICY IF EXISTS "Users can view own or shared pets" ON pets;
CREATE POLICY "Users can view own or shared pets" ON pets
  FOR SELECT USING (is_pet_member(id));

DROP POLICY IF EXISTS "Editors can update shared pets" ON pets;
CREATE POLICY "Editors can update shared pets" ON pets
  FOR UPDATE USING (is_pet_editor(id));

-- ── Child tables: add member SELECT + editor INSERT/UPDATE ─────────────────
-- These are ADDITIVE — your existing owner-only policies stay in place.
-- Postgres OR's multiple permissive policies together, so owners keep working
-- exactly as before; this just adds visibility/write access for shared users.
-- NOTE: medical history is stored in the "medical_records" table.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['medical_records', 'vaccinations', 'allergies', 'reminders', 'weight_logs', 'medicines', 'bills']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "shared_select_%1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "shared_select_%1$s" ON %1$I FOR SELECT USING (is_pet_member(pet_id))', t);

    EXECUTE format('DROP POLICY IF EXISTS "shared_insert_%1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "shared_insert_%1$s" ON %1$I FOR INSERT WITH CHECK (is_pet_editor(pet_id))', t);

    EXECUTE format('DROP POLICY IF EXISTS "shared_update_%1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "shared_update_%1$s" ON %1$I FOR UPDATE USING (is_pet_editor(pet_id))', t);
  END LOOP;
END $$;
