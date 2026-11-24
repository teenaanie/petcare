-- Demo data for the Google Play review account.
--
-- Run in the Supabase SQL editor. Safe to run twice: every row has a fixed id
-- and ON CONFLICT DO NOTHING, so a second run changes nothing.
--
-- Why it exists: a reviewer who signs in to an empty app sees an empty app,
-- and an empty app looks broken. These three pets give every screen something
-- to show -- a vaccination coming due, one overdue, a medicine, a past visit.
--
-- Every animal here is INVENTED. None of the owner's real pets appear.
--
-- To remove it all afterwards, see the DELETE block at the bottom.

-- The review account, found by email rather than hardcoded, so this cannot
-- quietly write into the wrong user's data if the id ever differs.
with reviewer as (
  select id from auth.users where lower(email) = 'pippy.review@gmail.com'
)
insert into public.pets (id, user_id, name, species, breed, gender, dob, weight, color,
                         vet_name, vet_phone, notes, temperament, created_at)
select v.id, r.id, v.name, v.species, v.breed, v.gender, v.dob, v.weight, v.color,
       v.vet_name, v.vet_phone, v.notes, v.temperament, now()
from reviewer r, (values
  ('aaaa0001-0000-4000-8000-000000000001'::uuid, 'Mowgli',  'Dog',  'Indie',    'Male',
   date '2022-06-14', 18.4, 'Tan',
   'Dr Anand', '+91 98200 11111',
   'Rescued from Aundh in 2022. Gentle with children.',
   'Calm, a little shy with strangers for the first few minutes.'),
  ('aaaa0001-0000-4000-8000-000000000002'::uuid, 'Kaju',    'Cat',  'Indie',    'Female',
   date '2024-03-02', 3.9, 'Ginger',
   'Dr Rao', '+91 98200 22222',
   'Indoor cat. Does not like the carrier.',
   'Affectionate once she knows you.'),
  ('aaaa0001-0000-4000-8000-000000000003'::uuid, 'Bubbles', 'Fish', 'Goldfish', 'Unknown',
   date '2025-08-20', null, 'Orange',
   null, null,
   'Tank cleaned fortnightly.', null)
) as v(id, name, species, breed, gender, dob, weight, color, vet_name, vet_phone, notes, temperament)
on conflict (id) do nothing;

-- Vaccinations: one due in days, one comfortably ahead, one just overdue, so
-- the reviewer sees all three states the app can show.
insert into public.vaccinations (id, pet_id, name, date_given, next_due, batch_number, vet, notes, is_done, created_at)
values
  ('bbbb0001-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001',
   'Nobivac DHPPi', current_date - 320, current_date + 2,  'SER-7741', 'Dr Anand', '', false, now()),
  ('bbbb0001-0000-4000-8000-000000000002', 'aaaa0001-0000-4000-8000-000000000001',
   'Anti-rabies',   current_date - 320, current_date + 44, 'AR-2210',  'Dr Anand', '', false, now()),
  ('bbbb0001-0000-4000-8000-000000000003', 'aaaa0001-0000-4000-8000-000000000002',
   'Felocell 3',    current_date - 180, current_date - 3,  'FC-9003',  'Dr Rao',   '', false, now())
on conflict (id) do nothing;

insert into public.medicines (id, pet_id, name, dosage, frequency, category, start_date, next_due, prescribed_by, reason, is_done, created_at)
values
  ('cccc0001-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001',
   'Bravecto', '500mg', 'Every 3 months', 'Flea/Tick', current_date - 60, current_date + 5,
   'Dr Anand', 'Tick prevention', false, now())
on conflict (id) do nothing;

insert into public.medical_records (id, pet_id, date, type, title, description, vet, cost, created_at)
values
  ('dddd0001-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001',
   current_date - 320, 'Checkup', 'Annual health check',
   'Weight and teeth fine. Advised to keep tick prevention going through the monsoon.',
   'Dr Anand', 850, now()),
  ('dddd0001-0000-4000-8000-000000000002', 'aaaa0001-0000-4000-8000-000000000002',
   current_date - 180, 'Illness', 'Mild stomach upset',
   'Off food for two days. Settled with a bland diet, no medication needed.',
   'Dr Rao', 600, now())
on conflict (id) do nothing;

insert into public.reminders (id, pet_id, type, due_date, frequency, notes, email, whatsapp, is_done, created_at)
values
  ('eeee0001-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001',
   'Vet Checkup', current_date, 'Yearly', 'Annual check', '', '', false, now())
on conflict (id) do nothing;

-- ── Afterwards, to remove every row above ────────────────────────────────
-- delete from public.reminders       where id::text like 'eeee0001-%';
-- delete from public.medical_records where id::text like 'dddd0001-%';
-- delete from public.medicines       where id::text like 'cccc0001-%';
-- delete from public.vaccinations    where id::text like 'bbbb0001-%';
-- delete from public.pets            where id::text like 'aaaa0001-%';
