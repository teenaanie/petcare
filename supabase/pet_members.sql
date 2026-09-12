-- Pet sharing: run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS pet_members (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_id     uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  role       text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  created_at timestamptz DEFAULT now()
);

-- Unique constraint: one invite per email per pet
ALTER TABLE pet_members
  ADD CONSTRAINT pet_members_pet_email_unique UNIQUE (pet_id, email);

-- Indexes
CREATE INDEX IF NOT EXISTS pet_members_pet_id_idx  ON pet_members(pet_id);
CREATE INDEX IF NOT EXISTS pet_members_user_id_idx ON pet_members(user_id);
CREATE INDEX IF NOT EXISTS pet_members_email_idx   ON pet_members(email);

-- Enable RLS
ALTER TABLE pet_members ENABLE ROW LEVEL SECURITY;

-- Owner can manage members (owner = the user who owns the pet)
CREATE POLICY "pet_owner_manage_members" ON pet_members
  FOR ALL USING (
    pet_id IN (SELECT id FROM pets WHERE user_id = auth.uid())
  );

-- Members can see their own membership row
CREATE POLICY "member_see_own_row" ON pet_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Update pets RLS to also allow members to SELECT
-- Run this to grant shared-pet SELECT access:
DROP POLICY IF EXISTS "Users can view own pets" ON pets;
CREATE POLICY "Users can view own or shared pets" ON pets
  FOR SELECT USING (
    user_id = auth.uid()
    OR id IN (
      SELECT pet_id FROM pet_members
      WHERE user_id = auth.uid()
         OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Allow editors to INSERT/UPDATE on shared pets
-- (viewers are SELECT only via the existing policies)
