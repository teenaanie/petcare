-- Notify on a due date that lives on the record itself.
--
-- Run this in the Supabase SQL editor.
--
-- Why it exists: Daisy's Felocell was recorded on 28 Sep with next_due =
-- 20 Oct. On 20 Oct nothing was sent. Nothing had failed -- the morning job
-- reads only the `reminders` table, and no row had ever been created for that
-- date. The app showed the owner a due date and then said nothing on the day.
--
-- `vaccinations.next_due` and `medicines.next_due` are now read by the morning
-- job directly. No reminder rows are created: a due date already saved is
-- simply told to the owner, which is the opt-in behaviour the owner asked for
-- (reminders are never added behind their back) without the silence.
--
-- This column is the bookkeeping that makes that safe. The job looks back
-- seven days to ride out a missed run, so without a record of what has already
-- gone out it would mail the same due date every morning for a week. It is the
-- same mechanism, and the same column name, as `reminders.notified_for_date`.

ALTER TABLE public.vaccinations
  ADD COLUMN IF NOT EXISTS notified_for_date date;

ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS notified_for_date date;

-- Everything already past is marked as handled, so deploying this does not
-- mail out a backlog on the first morning. Only dates from today forward will
-- notify.
UPDATE public.vaccinations
   SET notified_for_date = next_due
 WHERE next_due IS NOT NULL
   AND next_due < (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND notified_for_date IS DISTINCT FROM next_due;

UPDATE public.medicines
   SET notified_for_date = next_due
 WHERE next_due IS NOT NULL
   AND next_due < (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND notified_for_date IS DISTINCT FROM next_due;

-- The job filters on these every morning.
CREATE INDEX IF NOT EXISTS vaccinations_next_due_idx ON public.vaccinations (next_due);
CREATE INDEX IF NOT EXISTS medicines_next_due_idx    ON public.medicines    (next_due);
