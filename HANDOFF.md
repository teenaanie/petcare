# Pippy: handoff

Last updated: 2026-11-26. Keep this page current; it is the first place to look.
Lines marked **TO FILL** are things the code cannot tell us. Fill them in; do not guess.

## What it is

Pippy (pippypets.com) is a pet-care app. Pet parents track pets, health records,
reminders and a provider directory; businesses (vets, boarders, groomers) sign in
at `/business` to manage bookings. React + Vite front end, Vercel serverless
functions in `api/`, Supabase (Postgres, auth, RLS), and an Android wrapper (Capacitor).

"Done" for the current phase: see `docs/provider-platform-plan.md` (design and
settled decisions) and `docs/store-listing/` (Play Store).

## Run, test, deploy

- Run: `npm install && npm run dev` (needs `.env`; copy `.env.example`, which documents every variable).
- Tests: `npm run test:*` and `npm run check:*` (see `package.json`); `npm run test:sql` needs local PostgreSQL 16. `npm run lint` for ESLint.
- Deploy: Vercel builds from the repo. `VITE_*` values are baked in at build time, so changing one needs a redeploy.
- Database changes: the files in `supabase/` are run by hand in the Supabase SQL editor. They are not numbered migrations. **Record each one you apply in the table at the bottom.**
- Android: `npm run android:build`. Signing uses `android/app/keystore.properties` (gitignored; copy `keystore.properties.example`).

## Who owns what (P2)

| Thing | Account / owner | Notes |
|---|---|---|
| Domain pippypets.com | **TO FILL** | |
| Vercel project | **TO FILL** | Region: **TO FILL** (check it sits beside the DB) |
| Supabase project `lumgcfqsiwzbyfhjmkct` | **TO FILL** | Plan and backup window: **TO FILL** |
| OpenAI key | **TO FILL** | Spend cap: **TO FILL** |
| Resend (email) | **TO FILL** | Sending domain verified: **TO FILL** |
| Twilio (SMS) | **TO FILL** | |
| Google Play Console | **TO FILL** | Upload keystore: `~/pippy-upload.keystore` on the owner's Mac |
| Google Analytics | **TO FILL** | Loads only after consent |

## Needs the owner's yes (P3)

Production deploys, running any `supabase/*.sql` against production, data edits in
production (including provider import and reclassify scripts), changing a live
setting or env var, anything that spends money (OpenAI, Apify, SMS volume).

## AI in use

All calls are server-side (`api/_lib/`), per-user monthly limits, usage in `api_usage`.

| Job | Model | Where |
|---|---|---|
| Document scan | gpt-4o-mini | `analyze-document.js` |
| Health brief, voice parse | gpt-4o-mini | `ai-complete.js` |
| Voice transcription | whisper-1 | `transcribe.js` |

Models are hard-coded, not settings (checklist A1 open). Prices: `api/_lib/_pricing.js`.
External calls have timeouts (`api/_lib/_fetch.js`): 15 s email/SMS (never retried,
a timed-out send may have been delivered), 30 to 40 s OpenAI (one retry on 429/5xx).
Check Vercel's function `maxDuration` is at least as long as those.

## Known risks handled by process (bucket C)

| Risk | Likelihood | Impact | Why not in code | Who acts | What they do | How we notice |
|---|---|---|---|---|---|---|
| OpenAI credit runs out or runaway spend | Medium | AI features fail, or a surprise bill | Top-up needs a human with a card; the cap lives in OpenAI's dashboard | **TO FILL** | Set a monthly hard limit and a low-balance email in OpenAI → Billing → Limits; top up when it fires | OpenAI alert email; `usage-report` cron shows month-to-date cost |
| Database project deleted or corrupted | Low | All data lost | Cannot code around account access | **TO FILL** (account owner) | Restore from the latest backup. **A restore has not yet been tried.** Do one into a throwaway project and record the date below | Site down, error spike |
| Upload keystore lost | Low | Cannot ship updates to the Play listing | The key is a file on one Mac | **TO FILL** | Keep an encrypted copy in the password manager; if lost, request an upload-key reset from Play Console | Next release fails to sign |
| Keystore passwords exposed in git history | Happened once | Anyone with repo access could sign as us | History rewrite is a human decision | **TO FILL** | `android/app/keystore.properties` was committed in `6d6d4c5` and is now untracked. If the repo has ever been shared, change the key password with `keytool -keypasswd` and `-storepasswd` | n/a |
| Provider rate limit or plan quota hit | Medium | Some users blocked | Raising limits is a plan change | **TO FILL** | Check Supabase, Vercel, OpenAI and Resend plan limits before any launch push | **TO FILL** |

## Backup and restore log (D1)

| Date | Backup source | Restored into | Result |
|---|---|---|---|
| _none yet_ | | | |

## Database changes applied to production

| Date | File | Applied by |
|---|---|---|
| _not recorded before 2026-11-26; add from here on_ | | |
