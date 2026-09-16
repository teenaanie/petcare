-- Right to erasure — run in the Supabase SQL editor. Safe to re-run.
--
-- PROPOSED, NOT APPLIED. Read the warning before running it.
--
-- The problem, measured: 7 of 12 accounts cannot be deleted at all.
--
--     delete from auth.users where id = '…';
--     ERROR: update or delete on table "users" violates foreign key
--            constraint "pets_user_id_fkey" on table "pets"
--
-- pets.user_id -> auth.users is ON DELETE NO ACTION, so Postgres refuses the
-- delete outright for anyone who owns a pet. Every other table already
-- cascades: delete a pet and its records, vaccinations, medicines, bills,
-- weight logs, allergies, reminders and boarding trips go with it, verified to
-- leave zero orphaned rows. pets itself is the one link in the chain that was
-- never joined up, and it is the link that blocks the whole thing.
--
-- Today the only way to honour a deletion request is to delete the pets by
-- hand first and then the account — easy to get half-done, and nothing in the
-- app offers it.
--
-- WHAT THIS CHANGES, AND WHY IT NEEDS A DELIBERATE DECISION:
-- after this, deleting an account destroys every pet and every medical record
-- belonging to it, immediately and irreversibly. That is what erasure means,
-- and it is what the other twelve foreign keys already do — but it turns a
-- delete that currently fails loudly into one that succeeds silently and takes
-- years of a pet's medical history with it. Make sure backups are on before
-- running this, and consider offering an export first.

ALTER TABLE public.pets
  DROP CONSTRAINT IF EXISTS pets_user_id_fkey;

ALTER TABLE public.pets
  ADD CONSTRAINT pets_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Verify afterwards — should report CASCADE:
--   select conname,
--          case confdeltype when 'c' then 'CASCADE' when 'a' then 'NO ACTION' end
--   from pg_constraint where conname = 'pets_user_id_fkey';
