# Google Play Data safety — what was declared, and why

Filed November 2026 for `com.pippypets.app`.

Keep this current. A declaration that no longer matches the code is a policy
problem, not a stale document — and the next person to file this (including a
future you) will not remember why any of it was answered this way.

Every line below was checked against the code, with the file named. If a
feature changes, re-check the line that cites it.

## Data collection and security

| question | answer | why |
|---|---|---|
| Collects or shares user data | **Yes** | — |
| Encrypted in transit | **Yes** | Every endpoint is `https`. No `usesCleartextTraffic` in the manifest, so Android blocks plain HTTP on API 28+. `capacitor.config.json` sets `allowMixedContent: false` and `androidScheme: "https"`. The only `http://` strings in the repo are code comments. |
| Account creation methods | **Username and other authentication** | Email address plus a one-time emailed code. No `signInWithPassword`, no `signInWithOAuth` anywhere. Phone sign-in exists but is off — `PHONE_LOGIN_ENABLED = false` in `src/lib/authFlags.js`. |
| Delete account URL | `https://pippypets.com/delete-account` | Public page, no sign-in. Content derived from `api/_lib/delete-account.js`. |
| Partial deletion without deleting the account | **Yes** | Any single pet, vaccination, medicine, bill, photo or reminder can be deleted in the app. |

## Data types declared

| type | collected | ephemeral | required | purpose | evidence |
|---|---|---|---|---|---|
| Email address | yes | no | **required** | App functionality, Account management | The sign-in identifier |
| Phone number | yes | no | optional | App functionality | `pets.vet_phone`; phone sign-in is built but disabled |
| Name | yes | no | optional | App functionality | NOT the user's own — the app never asks for it. `pets.vet_name`, `medical_records.vet`, `vaccinations.vet`, `provider_customers.name` |
| Photos | yes | no | optional | App functionality | Pet photos, condition journal, scanned documents. Inputs accept `image/*` and `.pdf` |
| Voice or sound recordings | yes | **yes** | optional | App functionality | `src/lib/useVoiceRecorder.js` records and posts to `/api/transcribe`. The TEXT is kept; the audio is not stored |
| Files and docs | yes | no | optional | App functionality | Vet reports and bills, scanned via `/api/analyze-document` |
| Other actions | yes | no | optional | **Analytics** | Google Analytics events and Microsoft Clarity session recordings, `src/lib/analytics.js`. Off unless the user opts in, but the capability exists |
| Crash logs | yes | no | optional | Analytics | `src/lib/errorReport.js` → `/api/report-error` |
| Diagnostics | yes | no | optional | Analytics | Same reporter |

## Deliberately NOT declared

**Location** — the app never asks the device. No `geolocation` call exists. The
provider directory filters on city names the user picks from a list, which is
not location data.

**Health and fitness** — Google's category is the *user's* health. Pippy's
health records are about ANIMALS; the owner's own health is never collected.
Ticking it would assert something untrue and pull in policy requirements that
do not apply.

This is the one genuinely arguable call on the form. It was made deliberately,
not by omission. If Google ever queries it, the answer is: the app holds
veterinary records for pets, and no human health data of any kind.

**Payment info, address, race/ethnicity, political or religious beliefs,
sexual orientation, contacts, calendar, SMS, call logs, installed apps** — none
collected.

## Third parties the data reaches

Named here because they are also named on `pippypets.com/privacy`, and the two
must agree.

| who | what reaches them | why |
|---|---|---|
| Supabase | everything stored | Database, auth and file storage |
| Vercel | requests in transit | Hosting and the serverless functions |
| OpenAI | document images, voice audio, pet details being summarised | Scanning, transcription, health briefs |
| Resend | email addresses | Reminder and invitation email |
| Twilio | phone numbers | Reminder SMS, when enabled |
| Google Analytics | usage events | Only after the user opts in |
| Microsoft Clarity | session recordings | Only after the user opts in |

These are treated as **service providers processing on Pippy's behalf**, which
is why the data types are declared as *collected* rather than *shared*. Check
Play's current "definitions and exemptions" text before re-filing — this is
the point most likely to have changed.
