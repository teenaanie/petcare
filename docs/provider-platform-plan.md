# Provider platform — design plan

Status: for review. Nothing here is a commitment; the open decisions at the end
need your call before this becomes a PRD.

Every "current state" claim below was checked against the live Pippy project
(`lumgcfqsiwzbyfhjmkct`) and the repo on 2026-09-30, not recalled. Where I am
inferring rather than reporting, it says so.

---

## 1. The headline problem

The drafted work gives a business an **account** and no path to a single piece
of **customer data**. Everything you asked for — see boarded pets and their
history, a dashboard of upcoming/current/past customers, messages, a shared
drive — sits on one missing primitive: a record that says *this business may see
this pet, for this window, to this depth*. That record does not exist in the
schema, drafted or applied, and it is the hard part of the whole feature.

Two things make it harder than it looks:

1. **The provider/pet-parent split is not a security boundary.** The drafted
   `supabaseProvider` client separates the two by `storageKey`, so signing into
   one does not sign you into the other. Both sessions carry the *same*
   `auth.uid()`. No RLS policy can tell "signed in as a provider" from "signed
   in as a pet parent". The WIP comments say this plainly and correctly. The
   consequence: consent has to be modelled as data in the database, never
   inferred from which shell the request came from.

2. **There is no booking system.** `boarding_trips` exists but is created by the
   *pet parent* as a private prep checklist (2 rows live). A provider dashboard
   of "upcoming customers" has nothing to read until someone decides who creates
   and shares a stay.

---

## 2. Where things actually stand

### Already live and applied

| Thing | State |
|---|---|
| `providers` | 976 rows, Google-imported, read-only directory |
| `boarding_trips` | 2 rows; RLS is `is_pet_member()` / `is_pet_editor()` — pet-parent scoped only |
| `user_providers` | 6 rows; each parent's own list of vets/boarders/groomers |
| `pet_members` | 2 rows; email-keyed viewer/editor sharing, the universal access spine |
| `pet-photos` bucket | private, one bucket, path-prefixed by `pet_id` |
| `is_admin()` | exists, **hardcodes one email address** |
| Public tables | 21 total. No `provider_accounts`, no messaging, no appointments |

### Drafted, not applied, sitting in commit `ba61039`

- `supabase/provider_accounts.sql` — the account table, `is_provider_member()`,
  `current_user_phone()`, and three RPCs (`my_provider_accounts`,
  `claim_provider`, `admin_provider_accounts`). Header says NOT YET APPLIED, and
  the live database confirms it: none of those five functions exist.
- `src/components/provider/` — `ProviderApp`, `ProviderAuth`,
  `ProviderOnboarding`. Sign in by email or phone OTP, search the directory,
  claim a listing, wait for approval.
- `/business` route in `main.jsx`, lazily loaded.
- `netlify/functions/_notify.js` — the three outbound channels extracted out of
  `morning-reminders.js`, explicitly so the provider platform can send too.

I verified this code works as advertised: `npm run build` passes, the provider
bundle splits into its own 15.4 kB chunk that the pet-parent bundle does not
contain, and `npm run test:notify` passes 7 assertions. Both hosts already
rewrite every non-`/api` path to `index.html`, so `/business` needs no host
config — the WIP comment claiming that is accurate.

### Two blockers nobody has written down

**`is_admin()` is not in version control.** It exists only in the live database.
`provider_accounts.sql` calls it in five places, so the schema in this repo
cannot be rebuilt from the repo. Its body is:

```sql
SELECT EXISTS (SELECT 1 FROM auth.users
               WHERE id = auth.uid() AND email = 'teena.anie9@gmail.com');
```

**Every provider claim is approved by hand, by one person.** That is the right
posture for security — anyone can type a business name into a form — but it is
also the ceiling on how fast providers can be onboarded, and there is no admin
UI for it yet. `admin_provider_accounts()` returns the queue; nothing renders
it. `AdminDashboard.jsx` handles `providers.is_approved` only.

---

## 3. The keystone decision: how a provider reaches a pet

Four ways to build the missing primitive. This is the decision everything else
hangs off, so it gets the most space.

### Option A — extend `pet_members` with provider rows

Add `provider_id` to `pet_members`; teach `is_pet_member()` to return true when
`is_provider_member(provider_id)`.

- **For:** near-zero work. Twelve-plus policies across `pets`,
  `medical_records`, `vaccinations`, `allergies`, `reminders`, `weight_logs`,
  `medicines`, `bills`, `conditions`, `boarding_trips` and `user_providers`
  already route through that one function. Change it once, the whole provider
  read path lights up.
- **Against:** all-or-nothing depth, no time window, no revocation beyond
  deleting the row, and a `role='editor'` row would hand a boarder **write**
  access to a customer's medical record. Worst of all, it silently widens the
  single function a dozen policies depend on — one mistake there is a
  whole-directory leak, not a provider-scoped one.
- **Verdict: reject.** Cheapest to build, worst blast radius.

### Option B — a grant table plus additive RLS policies

New `provider_pet_grants` table, new `provider_can_read_pet(pet_id)` function,
additive `SELECT` policies on a chosen subset of pet tables.

- **For:** time-bounded, revocable, additive (existing owner policies untouched),
  and each table's exposure is an explicit reviewable line of SQL.
- **Against:** seven or so new policies to write and keep straight. RLS cannot
  express *column* depth — a provider granted `pets` sees every column on it,
  free-text `notes` included.
- **Verdict: close, but B alone can't control depth.**

### Option C — released snapshots ("stay packs")

The parent releases a stay; an RPC writes a JSONB snapshot of a whitelisted
field set into `stay_shares`.

- **For:** one table, one policy, nothing live exposed. The whitelist is a single
  function body, which is stronger depth control than RLS gives.
- **Against:** stale the moment a vaccination is updated, so it does not answer
  "see their history" as a living record. And it copies PII into a second place,
  which the existing `erasure_cascade.sql` would then have to chase.
- **Verdict: wrong as the primary mechanism; a good transport for the drive.**

### Option D — a grant table plus SECURITY DEFINER read RPCs *(recommended)*

Split the two questions. **Whether** a provider may read a pet is a row in
`provider_pet_grants`, checked by one gate function. **What** they see is an
explicit column list inside a `SECURITY DEFINER` RPC that calls that gate first.
No new RLS policies on any pet table at all.

```
provider_pet_grants
  provider_id, pet_id, granted_by, scope ('boarding'|'grooming'),
  starts_on, ends_on, revoked_at, created_at

provider_can_read_pet(pet_id) -> boolean
  EXISTS grant WHERE is_provider_member(provider_id)
    AND revoked_at IS NULL
    AND current_date BETWEEN starts_on AND ends_on + grace
```

- **For:** this is already the codebase's own pattern. `providers` has no
  user-facing `SELECT` policy at all — the directory is read through
  `search_providers()`, a `SECURITY DEFINER` function. `my_provider_accounts()`
  and `admin_provider_accounts()` in the drafted SQL do the same thing for the
  same reason. Following it means the provider read path can never accidentally
  widen a pet parent's own policies, because it does not touch them. It gets
  time-bounding and revocation from B and column-level depth from C.
- **Against:** `SECURITY DEFINER` bypasses RLS, so a function that forgets the
  gate check exposes everything. That is a real risk and it is mitigated by
  discipline, not by the database: one gate function, called first in every
  provider RPC, plus the boundary-test table that `provider_accounts.sql`
  already models at its foot. That test table is the control, and it should be
  filled in for real — the 2026-09-16 correction in this repo exists because a
  fixture that silently failed to grant a role turned every later "blocked" into
  a false pass.
- **Verdict: recommended.**

---

## 4. Scope

### Build (MVP)

| # | Feature | Notes |
|---|---|---|
| 1 | Provider sign-in at `/business` | drafted, needs applying and testing |
| 2 | Claim → admin approval | RPC drafted; **approval UI does not exist** |
| 3 | Parent shares a stay with the boarder | one button in `Boarding.jsx`, writes a grant |
| 4 | Provider dashboard: upcoming / current / past | reads shared stays, one RPC |
| 5 | Gated pet view | the whitelisted field set, per grant |
| 6 | Daily stay update: photo + note, provider → parent | one-way post on a trip |
| 7 | Broadcast to customers | fan-out through `_notify.js` |

### Defer, deliberately

- **1:1 in-app chat.** The largest item in the brief and the least
  differentiated. It needs unread counts, realtime, read receipts, per-message
  push and abuse handling, and a boarder who has the parent's number already
  messages them — the app links out to WhatsApp today. Build the **broadcast**
  instead: bulk updates are the thing WhatsApp does badly, they are what you
  actually asked for, and `_notify.js` was extracted for exactly this.
- **A general shared drive.** Item 6 plus provider *read* access to the pet's
  existing documents covers the real need. A general drive means upload quotas,
  virus scanning, retention and a second erasure path.
- **Provider-created bookings.** Keeps every provider write out of the schema
  for MVP. Revisit once real boarders are using the dashboard.
- **Anything vet-specific.** You said vets likely have their own tooling, and
  `ProviderOnboarding.jsx` already takes this line: accept a vet claim to capture
  the demand, build nothing for it.

Storage arithmetic for item 6, since the project is on the free tier: 1 GB, and
one bucket currently holding condition-journal photos. At roughly 200 KB a photo
that is about 5,000 stay photos. [Likely] fine for a pilot with a handful of
boarders; it needs a retention rule (drop stay photos N days after checkout)
before it scales, and that rule is cheaper to write now than to retrofit.

---

## 5. Build order

**Phase 0 — unblock.** Put `is_admin()` into `supabase/`. Decide the admin model
(see decision 2). Build the approval queue UI. Apply `provider_accounts.sql` and
record the boundary-test results in the file's own table.

**Phase 1 — the shell.** Commit and deploy what is drafted. End-to-end proof: a
real boarder signs in, claims, gets approved, sees their business name.

**Phase 2 — the grant.** `provider_pet_grants`, the gate function, the parent-side
share button. No provider-facing UI yet; verified by SQL boundary tests alone.

**Phase 3 — the dashboard.** Upcoming / current / past, reading shared stays.

**Phase 4 — the pet view.** The whitelisted fields, per grant.

**Phase 5 — updates and broadcasts.** Items 6 and 7.

Phases 0 and 2 are where the risk is. Phases 3–5 are ordinary product work once
the grant exists.

---

## 6. Decisions I need from you

1. **Access model** — Option D (grant table + gated RPCs). *Recommended.*
2. **Admin model** — keep one hardcoded email, or an `admins` table with a
   version-controlled `is_admin()`? *Recommendation: the table.* Not for
   security — for throughput. Provider onboarding otherwise stops whenever you
   are unavailable, and the current function cannot be rebuilt from this repo.
3. **Who creates a stay** — parent shares (MVP) or provider books? *Recommendation:
   parent shares.* It keeps provider writes out of the schema entirely and the
   parent-side flow already exists.
4. **Messaging** — broadcast only, WhatsApp for 1:1? *Recommended.*
5. **Drive** — stay updates plus gated read of existing documents, no general
   drive? *Recommended.*
6. **The field whitelist.** This one is genuinely yours, not mine — it is a
   privacy call about your customers, not a technical choice. My proposed
   starting set:

   - **Visible to a boarder or groomer during a granted stay:** name, species,
     breed, age, photo, the boarding profile (diet, feeding schedule,
     temperament, anxiety notes, triggers, handling notes, socialises with dogs),
     vaccinations, allergies, current medicines, emergency contact, vet name and
     phone.
   - **Not visible:** bills, medical records, weight logs, condition journal
     notes, reminders.

   Say what you would move across that line.

---

## 7. What I did not check, and why

- **I did not run the drafted SQL**, against the live database or a branch. It
  is unapplied by design and applying it is a decision, not a step. Its
  boundary-test table is therefore still empty, which means the drafted policies
  are *reviewed*, not *verified*. Treat them that way.
- **I did not open the provider shell in a browser.** I confirmed it compiles
  and code-splits; I did not confirm it renders or that an OTP round trip
  works. The claim, approval and sign-in path is untested end to end.
- **I did not audit the other tables' policies** beyond the ones `pet_members`
  and `boarding_trips` touch. If Option D is chosen this matters less, since the
  provider path adds no policies — but a Phase 2 review should still read
  `rls_hardening.sql` and `security_hardening.sql` in full.
- **I did not cost the notification fan-out.** Broadcasts to a boarder's whole
  customer list go out over Resend and Twilio, and Twilio SMS to Indian numbers
  is metered per message. Someone should put a number on a 100-customer
  broadcast before item 7 is built.
- **I did not look at whether `profiles` should get policies.** It has RLS on
  with zero policies, so it is unreadable from the client, which is why the
  drafted code uses `provider_accounts` as its role source instead. That is the
  right call and leaves `profiles` alone; no work needed, but it is a standing
  oddity worth knowing about.
