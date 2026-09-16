-- Boarding prep: run this in your Supabase SQL editor (safe to re-run).
--
-- Three things:
--   1. A boarding profile on `pets` — what a boarder needs to know to look
--      after the animal for a few days (diet, temperament, handling).
--   2. `providers.boarding_policy` — each boarder's published requirements as
--      data, so a new facility is a row, not a code change.
--   3. `boarding_trips` — one planned stay, with the parent's manual answers
--      layered over what the app can derive from the pet's own records.

-- ── 1. Boarding profile on pets ──────────────────────────────────────────────
-- No RLS work needed: the pets policies are row-level, and is_pet_editor(id)
-- from pet_members.sql already governs UPDATE.

ALTER TABLE pets ADD COLUMN IF NOT EXISTS food_preferences     text[];
ALTER TABLE pets ADD COLUMN IF NOT EXISTS feeding_schedule     text;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS diet_notes           text;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS temperament          text;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS anxiety_notes        text;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS triggers             text[];
ALTER TABLE pets ADD COLUMN IF NOT EXISTS socialises_with_dogs boolean;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS handling_notes       text;

-- ── 2. Per-provider boarding policy ──────────────────────────────────────────
-- search_providers() returns to_jsonb(p), so this column reaches the client
-- with no change to the RPC. That function is SECURITY DEFINER and granted to
-- anon, so treat this column as PUBLISHED information — it is world-readable
-- to anyone holding the anon key. Requirements and rate cards are already
-- public; do not put anything operational in here.

ALTER TABLE providers ADD COLUMN IF NOT EXISTS boarding_policy jsonb;

-- ── 3. Boarding trips ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boarding_trips (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_id        uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  provider_id   uuid REFERENCES providers(id) ON DELETE SET NULL,
  provider_name text,
  start_date    date,
  start_slot    text,
  end_date      date,
  end_slot      text,
  trial_date    date,
  is_first_stay boolean DEFAULT true,
  -- { requirementId: { done, date, note } } — the keyspace is fixed by the
  -- provider's policy and is never queried across trips, so a blob beats a
  -- row per item. Same call as bills.line_items.
  checklist     jsonb DEFAULT '{}'::jsonb,
  -- Reminders have no natural key, so remember what we created and clean up
  -- on regenerate; otherwise a second tap doubles the user's 7am inbox.
  generated_reminder_ids uuid[] DEFAULT '{}',
  notes         text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boarding_trips_pet_id_idx ON boarding_trips(pet_id);

-- Unlike the tables wired up in pet_members.sql, this one is brand new and has
-- no pre-existing owner-only policy for those to be additive to. So all four
-- verbs are spelled out here — in particular DELETE, without which deleting a
-- trip would silently do nothing.

ALTER TABLE boarding_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "boarding_trips_select" ON boarding_trips;
CREATE POLICY "boarding_trips_select" ON boarding_trips
  FOR SELECT USING (is_pet_member(pet_id));

DROP POLICY IF EXISTS "boarding_trips_insert" ON boarding_trips;
CREATE POLICY "boarding_trips_insert" ON boarding_trips
  FOR INSERT WITH CHECK (is_pet_editor(pet_id));

DROP POLICY IF EXISTS "boarding_trips_update" ON boarding_trips;
CREATE POLICY "boarding_trips_update" ON boarding_trips
  FOR UPDATE USING (is_pet_editor(pet_id));

DROP POLICY IF EXISTS "boarding_trips_delete" ON boarding_trips;
CREATE POLICY "boarding_trips_delete" ON boarding_trips
  FOR DELETE USING (is_pet_editor(pet_id));

-- ── 4. Seed: Unleash – The Dog Town ──────────────────────────────────────────
-- Mirrors UNLEASH_POLICY in src/lib/boarding.js. This is a seed, not a
-- migration you have to keep in step: from here on the rules are edited in
-- Admin → Boarding, which writes this same column. A boarder with no policy
-- shows GENERIC_POLICY — the criteria most boarders ask for, and no invented
-- hours, rates or menu.

UPDATE providers SET boarding_policy = '{
  "name": "Unleash – The Dog Town",
  "required": ["vaccination_records","kennel_cough","tick_protection","deworming","vet_confirmation","trial_visit","diet_brief","bedding","original_records","govt_id","declaration"],
  "trial_required": true,
  "kc_lead_days": 7,
  "kc_valid_days": 365,
  "deworm_valid_days": 90,
  "tick": {
    "lead_days": 2,
    "default_duration_days": 30,
    "accepted": ["spot-on", "bravecto", "nexgard", "simparica"],
    "rejected": [
      { "pattern": "collar", "reason": "This boarder does not accept tick collars." },
      { "pattern": "spray",  "reason": "This boarder does not accept tick sprays." },
      { "pattern": "powder", "reason": "This boarder does not accept tick powders." }
    ]
  },
  "requirement_notes": {
    "govt_id": "Two original government photo IDs with address, carried by the pet parent. Required for first-time boarders.",
    "bedding": "A small rug, bedsheet or dari. Leave fancy leashes, expensive beds and favourite toys at home.",
    "kennel_cough": "Available at your vet. Mandatory here.",
    "vet_confirmation": "Written confirmation of tick protection and timely deworming."
  },
  "slot_windows": [
    { "id": "morning", "label": "Morning", "from": "08:00", "to": "11:00" },
    { "id": "evening", "label": "Evening", "from": "17:00", "to": "20:00" }
  ],
  "pricing": {
    "currency": "INR", "full_day": 1000, "day": 600, "night": 600,
    "last_minute_days": 3,
    "note": "Rates change — always confirm current pricing before the stay."
  },
  "food_menu": [
    { "id": "chicken_rice",  "label": "Home-cooked chicken, rice & veg",  "extra_charge": false },
    { "id": "egg_rice",      "label": "Home-cooked egg, rice & veg",      "extra_charge": false },
    { "id": "fish_rice",     "label": "Home-cooked fish, rice & veg",     "extra_charge": true  },
    { "id": "curd_rice",     "label": "Curd rice (with or without honey)", "extra_charge": false },
    { "id": "potato",        "label": "Boiled potatoes",                  "extra_charge": false },
    { "id": "kibble",        "label": "Kibble — Pedigree / Chappie / Smart Heart / Meat Up", "extra_charge": false },
    { "id": "kibble_rc",     "label": "Kibble — Royal Canin",             "extra_charge": true  },
    { "id": "boiled_chicken", "label": "Plain boiled chicken",            "extra_charge": false },
    { "id": "boiled_chicken_boneless", "label": "Plain boiled chicken (boneless)", "extra_charge": true },
    { "id": "boiled_eggs",   "label": "Boiled eggs",                      "extra_charge": false },
    { "id": "bhakri",        "label": "Bhakri",                           "extra_charge": true  },
    { "id": "curd",          "label": "Plain curd / buttermilk",          "extra_charge": false },
    { "id": "icecream",      "label": "Vanilla ice cream",                "extra_charge": false },
    { "id": "biscuits",      "label": "Dog / Marie biscuits",             "extra_charge": false }
  ],
  "food_note": "Anything outside this menu can be arranged with advance notice, at extra cost.",
  "bring": ["A small rug, bedsheet or dari", "Original vaccination record book", "Two govt photo IDs with address"],
  "do_not_bring": ["Fancy leashes", "Expensive beds", "Favourite toys"],
  "advisories": [
    { "months": [3,4,5], "text": "No air-conditioning — coolers, fans and sprinklers are used. Conjunctivitis, kennel cough and wheezing occasionally occur in summer." },
    { "months": [6,7,8,9], "text": "Monsoon: hotspots, skin issues and digestive trouble are more likely, and the tick-free campus is harder to maintain. Active tick protection matters most now." }
  ],
  "arrival_notes": "Please do not honk on arrival — call or message from the gate.",
  "extras_note": "Pick-up and drop is available at extra cost, through a third-party vendor."
}'::jsonb
-- Exact match, not ILIKE '%unleash%'. The loose version attached this
-- facility's rate card and menu to a bare manually-added row called
-- "Unleashed", which is the same mistake — one boarder's terms under another
-- boarder's name — that the GENERIC/UNLEASH split exists to prevent.
-- For any other boarder, use Admin → Boarding rather than editing this file.
WHERE name = 'Unleash – The Dog Town';
