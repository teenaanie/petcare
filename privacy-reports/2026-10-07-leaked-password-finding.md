# Leaked-password protection — closed as not applicable

**Date:** 2026-10-07 · **Project:** Pippy (`lumgcfqsiwzbyfhjmkct`) · **Live:** pippypets.com
**Closes:** recommended action 2 of `2026-09-16-privacy-audit.md`
**Status:** WARN, accepted. Not a finding against this project.

This is a single-finding note, not a full audit. The baseline's recommendation
was *"Enable leaked-password protection. Supabase → Authentication. Dashboard
toggle; checks signups against HaveIBeenPwned."* The Supabase advisor has
repeated it at every check since. It should not be carried forward, and this
records why.

## Verdict

**The setting would protect nothing, because this project has no password
sign-in path.** Enabling it is also not possible on the current plan. Both halves
of that need to stay true for this to remain closed — see *When this reopens*.

## Why it does not apply

Leaked-password protection checks a password against HaveIBeenPwned **at the
moment somebody sets one**. Nothing in Pippy ever sets one.

Verified by reading the source rather than assuming: there is no
`signInWithPassword`, no `signUp` with a password, and no `resetPasswordForEmail`
anywhere under `src/` or `api/`. Both sign-in surfaces are one-time code only —
`PhoneAuth.jsx` for pet parents and `provider/ProviderAuth.jsx` for businesses,
each using `signInWithOtp` and `verifyOtp`.

## The thing that looked alarming, and was not

`auth.users.encrypted_password` is **populated for 6 of 17 accounts**, which
contradicts an app with no passwords. It was worth running down. It is benign.

**A clean temporal split, no exceptions either way:**

| Created | Accounts | `encrypted_password` |
|---|---|---|
| 2026-08-07 → 2026-09-23 | 11 | empty |
| 2026-09-28 → 2026-10-06 | 6 | 60-char `$2a$` bcrypt hash |

**All 17 were created identically.** `email_confirmed_at` and `recovery_sent_at`
are both stamped at the creation instant, and first sign-in follows 16–68
seconds later. That is the one-time-code signup path. None was created through
the dashboard's *Add user* dialog, which was the first hypothesis and was wrong:
that path leaves `confirmation_sent_at` null and auto-confirms differently.

**The hashes are not of anything guessable.** Each of the six was tested with
`crypt()` against the empty string, the account's own email address, `password`
and `123456`. No match on any of them. Only trivially-weak candidates were
tried; a match on one would itself have been the vulnerability.

**Conclusion [Likely].** GoTrue changed between 23 and 28 September and now
writes a bcrypt hash of a random value for one-time-code accounts where it
previously left the column empty. A clean 11/6 split with identical creation
signatures on both sides is difficult to explain any other way. These are hashes
of secrets nobody holds — not the account owner, not the user, not an attacker —
so `signInWithPassword` cannot succeed for any of them. A populated column, not
a credential.

## The plan gate

Leaked-password protection is **Pro plan and above**. This organisation is
`tier_free`, so the toggle is unavailable regardless of whether it would help.
Recorded so that a future reader does not spend a plan upgrade on a setting that
would protect nothing here.

## When this reopens

Immediately, if **password sign-in is ever added** — `signInWithPassword`,
password signup, or a reset flow. At that point:

1. The setting becomes genuinely useful and needs the Pro plan.
2. **The six accounts above must be forced through a password reset**, not left
   to inherit a random hash. A user who has never set a password must not end up
   with an account that has one.

Grep for `signInWithPassword` before closing this again.

## What I could not check

- **`auth.audit_log_entries` is empty.** Free-plan retention is about a day, so
  there is no record of how the September accounts were created. The conclusion
  above rests on row state, not on an audit trail.
- **The GoTrue changelog.** This environment's network policy blocks the hosts
  that would confirm the version change directly, so the cause is inferred from
  the data rather than read from release notes.
- **Whether the six users would be told.** If password login is ever added, the
  forced reset in step 2 is a user-facing decision, not only a technical one.
