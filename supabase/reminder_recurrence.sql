-- supabase/reminder_recurrence.sql
--
-- Two faults this fixes, both of which made reminders silently under-deliver.
--
-- 1. A recurring reminder never recurred. Nothing in the app or the cron ever
--    advanced `due_date`, and `markReminderDone` only flips `is_done`. So a
--    "Monthly" flea treatment fired on its first due date and never again.
--
-- 2. A missed day was a permanently missed reminder. The cron matched
--    `due_date = today` exactly, so if it did not run, or the send failed, that
--    occurrence was gone. Two reminders in this database were never delivered
--    for exactly this reason.
--
-- The catch-up window that fixes (2) needs a way to know what has already been
-- sent, or an overdue reminder would be re-sent every morning for a week. That
-- is what this column is for: it records the `due_date` a notification actually
-- went out for, not merely the day the job ran.
--
-- Why the due date and not a timestamp: when a recurring reminder rolls over,
-- `due_date` changes, so it stops matching this column and the next occurrence
-- notifies on its own. One column covers both cases with no extra bookkeeping.

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS notified_for_date date;

COMMENT ON COLUMN public.reminders.notified_for_date IS
  'The due_date a notification was last successfully sent for. NULL means never '
  'notified. The morning-reminders job skips a reminder whose notified_for_date '
  'already equals its due_date, which is what stops the catch-up window from '
  're-sending the same occurrence every day.';

-- The job now scans a date range rather than a single day, on every run.
CREATE INDEX IF NOT EXISTS reminders_due_pending_idx
  ON public.reminders (due_date)
  WHERE is_done = false;

-- Existing rows stay NULL deliberately. A NULL means "never notified", so the
-- first run after this lands will pick up anything still pending inside the
-- catch-up window -- including occurrences that were genuinely never delivered.
-- It will NOT pick up older ones: the window is deliberately short so that
-- deploying this does not blast months of history at everybody at once.
