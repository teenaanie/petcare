# Privacy audit — September 2026 (baseline)

**Date:** 2026-09-16 · **Project:** Pippy (`lumgcfqsiwzbyfhjmkct`) · **Live:** pippyapp.vercel.app

## Verdict

**All 11 checks pass.** This is the baseline report, so there is nothing to
compare against — but three findings were opened and closed today, including one
that made it impossible to delete 7 of 12 accounts.

## Regressions since last month

None — no previous report exists.

## Open findings

| Check | Severity | Status | Detail |
|---|---|---|---|
| `anon` holds write grants | HIGH | REVIEW | 14 tables. Supabase's default; RLS denies every one of them. Verified, not merely assumed. |
| `agent_runs` RLS on, no policies | INFO | REVIEW | Deliberate: deny-all, service role only. |

Both are "REVIEW" rather than "FAIL" — they are expected states recorded so they
stay deliberate rather than drifting unnoticed.

## Fixed today

**1. Anyone could burn another user's AI quota** — HIGH, applied

`api_usage` carried `"service role inserts" INSERT TO public WITH CHECK (true)`.
The name states the intent; the grant does not match it. `public` includes
`anon`, and `WITH CHECK (true)` places no constraint on `user_id`. Confirmed
live: an anonymous visitor could insert usage rows attributed to another user
and exhaust their monthly AI limit. Dropped — `service_role` bypasses RLS, so it
was never load-bearing.

**2. Account deletion was impossible for 7 of 12 accounts** — HIGH, applied

```
delete from auth.users where id = '…';
ERROR: violates foreign key constraint "pets_user_id_fkey" on table "pets"
```

`pets.user_id -> auth.users` was `ON DELETE NO ACTION`. Every other foreign key
already cascaded; `pets` was the one link never joined up, and it blocked the
whole chain. A right-to-erasure request could not be honoured without deleting
pets by hand first. Now `CASCADE`, verified in a rolled-back transaction:
deleting an account owning 7 pets leaves 0 pets, 0 orphaned records, 0 orphaned
reminders.

**3. Every OpenAI call ran from the browser** — HIGH, applied earlier today

`VITE_OPENAI_API_KEY` was compiled into the public bundle. Worse, the document
scanner's guard `const USE_FUNCTION = !OPENAI_KEY` meant setting that variable
*disabled* the authenticated, rate-limited proxy that already existed. All four
AI calls now go through server functions that check the caller's session and cap
usage per user per month.

**4. `pet_members` hard-errored for signed-out visitors** — LOW, applied

Its SELECT policy calls `current_user_email()`, which `anon` could not execute.
Failed closed, so never a leak.

## Isolation verified, not assumed

Impersonated `anon` and a real non-admin user against production. All write
probes inside `BEGIN … ROLLBACK`.

| Probe | Result |
|---|---|
| Stranger reads another user's pet or records | 0 rows |
| Stranger updates or deletes another user's pet | blocked |
| Stranger self-grants membership of a pet | blocked by RLS |
| **Editor** rewrites `pets.user_id` to themselves | blocked |
| **Editor** deletes the shared pet, or adds members | blocked |
| **Viewer** (read-only) inserts a medical record | blocked by RLS |
| User inserts or defaces a provider | blocked |
| User sets `profiles.is_admin = true` | blocked |
| Anonymous visitor reads any user table | 0 rows |

`get_all_users_for_admin()` is `SECURITY DEFINER` and callable by any signed-in
user, which the linter flags — but it is gated internally
(`WHERE is_admin() OR auth.role() = 'service_role'`) and returns nothing to a
non-admin. All 5 `SECURITY DEFINER` functions pin `search_path`.

## Data inventory

- 12 users, 13 pets, 45 medical records, 13 reminders, 976 providers (965 approved).
- **No storage buckets exist.** No photos stored anywhere today.
- No orphaned rows. No invite emails held for people who never signed up.
- Oldest medical record: 2022-01-16.
- Provider table holds business contact details only — public directory data.

## Third-party egress

| Host | Carries |
|---|---|
| `api.openai.com` | Scanned document images, pet health records. Documents may contain the owner's name, address and phone. |
| `api.resend.com` | Reminder emails |
| `api.twilio.com` | Reminder SMS — phone numbers |
| `api.emailjs.com` | Browser-sent reminder emails |
| `unpkg.com` | pdf.js worker — discloses IP and referrer on document scan |

## What I could not check

- **Vercel environment variables.** No CLI access; inferred from endpoint
  behaviour rather than read directly.
- **Whether the exposed OpenAI key was rotated.** Outside the database.
- **Vercel log retention and who can read it.** Account-level setting.
- **Backups.** Not verified before the `CASCADE` change.

## Recommended actions

1. **Redact PII from logs.** `netlify/functions/morning-reminders.js` writes user
   emails (~line 213) and phone numbers (~line 226) to Vercel logs. LOW, easy.
2. **Enable leaked-password protection.** Supabase → Authentication. Dashboard
   toggle; checks signups against HaveIBeenPwned.
3. **Rotate the OpenAI key** if not already done — it was public in two bundles.
4. **Offer account deletion in the app.** Erasure now works at the database
   level, but nothing in the UI exposes it, and an export before deletion would
   be kind given it is irreversible.
5. **Restrict the EmailJS public key** to your domain in the EmailJS dashboard
   before setting `VITE_EMAILJS_*` — otherwise anyone can send through your
   templates.
