# Privacy audit — 21 September 2026

**Project:** Pippy (`lumgcfqsiwzbyfhjmkct`) · **Live:** pippyapp.vercel.app · **Build:** `7e8418a`
**Compares against:** 2026-09-16 (baseline)

## Verdict

**Nothing got worse. All checks pass, and the one HIGH finding open at the last
report is closed.** This is the first complete run — the 16 September baseline
was written by hand, and the scheduled agent has never finished a run of its own.

## Regressions since the last report

**None.** Every check that passed on 16 September still passes.

## Open findings

| Check | Severity | Status | Detail |
|---|---|---|---|
| `anon` holds write grants | HIGH | REVIEW | 14 tables. Supabase's default. RLS denies every one — probed live, not assumed. |
| `agent_runs` RLS on, no policies | INFO | REVIEW | Deliberate deny-all; service role only. |
| Leaked-password protection disabled | WARN | OPEN | Supabase → Authentication. A dashboard toggle, not SQL. |

Both REVIEW rows are expected states, recorded so they stay deliberate rather
than drifting unnoticed.

## Closed since 16 September

**Pet ownership takeover — HIGH.** An editor on a shared pet could rewrite
`pets.user_id` to themselves and, as the new owner, delete the pet and its
entire medical history. Fixed by a `BEFORE UPDATE` trigger
(`supabase/pet_owner_takeover.sql`); the guard is now itself a check in this
audit, so it cannot quietly disappear.

Worth recording how it was found. The 16 September report said this was
*blocked*. It was not — the test behind that line inserted a `pet_members` row
carrying only an email, while `is_pet_editor()` resolves the caller's email from
`auth.users`, so the simulated attacker was never an editor and "blocked"
measured nothing. **The monthly audit agent flagged the policy independently,
which is what prompted the re-test.** Every escalation in this run now asserts
its own fixture before attacking.

**`CRON_SECRET` — HIGH.** `/api/morning-reminders` was callable by anyone, which
both triggered real emails and SMS and listed every recipient in the response.
Now returns 401 to an unauthenticated caller.

**PII in logs, responses and run records — LOW.** Contact details are masked at
the point the payload is built, so the HTTP response and `agent_runs.results`
are covered, not only log lines. 9 masking calls in `morning-reminders.js`; no
raw `${userEmail}`, `${phone}`, `${to}` or `${body}` survives on any log path.

## Isolation — verified live, not assumed

All probes inside `BEGIN … ROLLBACK`. The fixture proves itself before any
result counts: `editor=true viewer=true`.

| Probe | Result |
|---|---|
| Stranger sees pets that are not theirs or shared with them | **0 rows** |
| Anonymous visitor: pets, records, vaccinations, bills, members, profiles, usage, push | **0 each** |
| Anonymous visitor: providers | 965 (approved only — intended) |
| **Editor** takes ownership / deletes the pet / adds a member | blocked |
| **Editor** edits the pet | allowed — correct, the feature still works |
| **Viewer** writes a record / takes ownership | blocked |
| User self-promotes via `profiles.is_admin` | blocked |
| User writes to the provider directory | blocked |
| Anonymous burns another user's AI quota | blocked |
| Non-admin calls `get_all_users_for_admin()` | blocked (0 rows) |

## Public surface

```
bundle /assets/index-BL2lxVUE.js   build 7e8418a
  sk- literals ....... 0
  api.openai.com ..... 0
  service_role ....... 0

/api/ai-complete ......... 401
/api/transcribe .......... 401
/api/analyze-document .... 401
/api/delete-account ...... 401
/api/morning-reminders ... 401   (CRON_SECRET holding)
```

Client-side `VITE_` values in source are the three publishable ones —
`VITE_EMAILJS_PUBLIC_KEY`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`.
All designed to be public. No others.

`api.openai.com` does appear in the source — in `netlify/functions/`, which is
server-side and correct. What matters is that it is absent from the client
bundle, and it is.

## Data inventory

12 users · 13 pets · 45 medical records · 15 reminders · 976 providers (965
approved) · 0 storage buckets · 0 sharing rows · oldest record 2022-01-16.

### AI usage since the proxies went in

| Task | Calls | Users |
|---|---|---|
| `voice_reminder` | 6 | 1 |
| `health_summary` | 2 | 1 |
| `vet_questions` | 2 | 1 |
| `transcribe` | **0** | — |

Six voice reminders parsed and **zero Whisper calls**: transcription is coming
entirely from the browser's own speech recognition, with the paid fallback never
needed. That is the design working, and it also confirms the full chain — auth,
rate limit, usage logging — is live in production.

## Third-party egress

| Destination | Carries |
|---|---|
| Google / Apple speech servers | **Voice audio**, via the browser's Web Speech API |
| `api.openai.com` | Scanned documents, health records, transcripts (server-side only) |
| `api.resend.com` | Reminder emails |
| `api.twilio.com` | Reminder SMS — phone numbers |
| `api.emailjs.com` | Browser-sent reminder emails (unconfigured today) |
| `unpkg.com` | pdf.js worker — discloses IP and referrer on document scan |

The first row has **no URL anywhere in the source**, so no grep will ever find
it. Checked deliberately, and all three guarantees hold: the opt-out key exists,
it is honoured before recognition starts, and the UI names the company receiving
the audio.

## What I could not check

- **Vercel environment variables directly** — no CLI access. Their presence is
  inferred from endpoint behaviour (a missing one returns 503 naming itself; all
  five endpoints return 401).
- **Whether the exposed OpenAI key was rotated.** Outside the database, and
  still unconfirmed since 16 September.
- **`RESEND_API_KEY`, `TWILIO_*`, `VAPID_*`** — `CRON_SECRET` now correctly
  blocks the probe that would have revealed them. Working as intended, but it
  means their state is unknown from here.
- **Vercel log retention and who can read it.** Account-level setting.
- **Whether the scheduled agent can complete a run unattended.** It has not yet.

## Recommended actions

1. **Rotate the OpenAI key.** It sat in two public bundles. Open since 16
   September and the only item on this list with a live exposure behind it.
2. **Enable leaked-password protection** — Supabase → Authentication. One toggle.
3. **Prove the scheduled run can finish.** Both attempts stalled on a tool
   approval at the first Bash call, and a stalled run also *blocks* the next
   scheduled one. Dispatch it once while watching, approve the prompt, and the
   approval is stored for 1 October.
4. Optional: set `VITE_EMAILJS_*` to restore the per-reminder Send email button.
   Restrict the key to your domain in the EmailJS dashboard first.
