# Provider platform — design plan

Status: for review. Nothing here is a commitment; the open decisions at the end
need your call before this becomes a PRD.

Every "current state" claim below was checked against the live Pippy project
(`lumgcfqsiwzbyfhjmkct`) and the repo on 2026-09-30, not recalled. Where I am
inferring rather than reporting, it says so.

**Revision, 2026-10-01.** The access model changed, and it changed for the
better. Section 3 used to propose granting a provider scoped read access to a
customer's pet records. It now proposes the opposite: no record access at all,
ever. The customer composes a note, edits it, sends it, and that note is the
only thing the provider can read. Section 3.5 keeps the rejected options on the
record so the reasoning is not lost.

---

## 1. The headline risk, under the new model

The hard problem the old plan had — building a scoped, revocable, time-bounded
grant over eleven pet tables — is gone. The inform-note model dissolves it. What
replaces it is a smaller problem, but a real one, and it is clinical rather than
architectural:

**A sent note is frozen, and the provider cannot tell how stale it is.**

A grant shows live data: if the rabies booster lapses on the 12th, a provider
reading on the 13th sees that. A note sent on the 1st says what was true on the
1st, forever, and reads as current. A boarder deciding whether to put a dog in a
shared run is acting on it. So three things are not optional:

1. Every fact in a note carries **its own date**, not just the note's send date.
   "Rabies — 14 Mar 2026" and "no medical records in the last 6 months" are both
   facts; "up to date" is not.
2. The provider's view stamps **age** prominently — "sent 23 days ago", and
   something louder past a threshold.
3. The customer can **re-send**, superseding the old note rather than appending a
   second one that contradicts it.

The second risk is the mirror of the model's main virtue. Because nothing is
shared, nothing can be *un*-shared: a sent note is a copy in someone else's
hands with no expiry. A grant can be revoked; a note cannot be recalled. We
trade **breadth** risk (the provider sees too many fields) for **duration** risk
(the provider keeps a copy forever). Breadth is the one worth eliminating, so
this is the right trade — but withdrawal needs a deliberate answer, not silence.
See decision 2.

---

## 2. Where things actually stand

### Already live and applied

| Thing | State |
|---|---|
| `providers` | 976 rows, Google-imported, read-only directory |
| `user_providers` | 6 rows; each parent's own vets/boarders/groomers, household- or pet-scoped |
| `pet_members` | 2 rows; email-keyed viewer/editor sharing, the universal access spine |
| `boarding_trips` | 2 rows; pet-parent scoped prep checklist |
| `pet-photos` bucket | private, one bucket, path-prefixed by `pet_id` |
| `ai-complete.js` | closed task registry, server-side prompts, cost logged to `api_usage`, 100 calls/user/month **per task** |
| `is_admin()` | exists, **hardcodes one email address** |
| Public tables | 21 total. No `provider_accounts`, no messaging, no appointments |

### Drafted, not applied, now committed

- `supabase/provider_accounts.sql` — the account table, `is_provider_member()`,
  `current_user_phone()`, and three RPCs. Header says NOT YET APPLIED, and the
  live database confirms it: none of those five functions exist.
- `src/components/provider/` — sign in by email or phone OTP, search the
  directory, claim a listing, wait for approval.
- `/business` route in `main.jsx`, lazily loaded.
- `netlify/functions/_notify.js` — the three outbound channels extracted out of
  `morning-reminders.js`, explicitly so the provider platform can send too.

Verified: `npm run build` passes, the provider bundle splits into its own 15.4 kB
chunk that the pet-parent bundle does not contain, and `npm run test:notify`
passes 7 assertions. Both hosts already rewrite every non-`/api` path to
`index.html`, so `/business` needs no host config.

### Two blockers nobody had written down

**`is_admin()` is not in version control.** It exists only in the live database.
`provider_accounts.sql` calls it in five places, so the schema in this repo
cannot be rebuilt from the repo. Its body is:

```sql
SELECT EXISTS (SELECT 1 FROM auth.users
               WHERE id = auth.uid() AND email = 'teena.anie9@gmail.com');
```

**Every provider claim is approved by hand, by one person.** The right posture
for security — anyone can type a real business's name into a form — and also the
ceiling on provider onboarding. `admin_provider_accounts()` returns the queue;
nothing renders it. `AdminDashboard.jsx` handles `providers.is_approved` only.

---

## 3. The access model: the inform note

### The flow

1. A customer has providers in **My Providers** (`user_providers`). Some of those
   rows point at a directory listing; some were typed in by hand.
2. Where a row points at a listing **and** that listing has been claimed by an
   approved account, the pet screen shows **Inform provider**.
3. Tapping it opens a draft: a facts block built from that pet's own records,
   plus a short covering note.
4. The customer **edits anything**, adds a stay window if relevant, picks which
   contact detail to include, and sends.
5. The note lands as a row readable by both sides. The customer sees it under
   the pet as "informed Unleash on 1 Oct". The provider sees it in their book,
   under that pet.

Nothing else moves. The provider gets no row from `pets`, no vaccination record,
no medicine, no bill, no document. **The note is the entire provider-side read
surface.**

### Why this is the better model

- **Depth control is by construction.** The customer reads the exact text that
  goes out. No field whitelist can be as trustworthy as that, because no
  whitelist survives a schema change — a column added to `pets` next year is
  automatically visible under a grant and automatically invisible here.
- **The provider never reads a pet table**, so there is no additive policy on
  `pets`, `vaccinations`, `allergies`, `medicines`, `medical_records`, `bills`,
  `weight_logs`, `reminders`, `conditions`, `condition_notes` or
  `boarding_trips`. Eleven tables keep exactly the policies they have today.
- **Erasure stays simple.** One table, cascading on `pet_id`.
- **It needs no booking system to be useful.** A note stands on its own.

### The shape

```
provider_notes
  id
  provider_id    -> providers(id)          the business informed
  pet_id         -> pets(id)   ON DELETE CASCADE
  sent_by        -> auth.users(id)         the customer who sent it
  body           text                      the covering note, as sent
  facts          jsonb                     the facts block, as sent
  pet_label      text                      denormalised: name, species, breed
  contact_name   text
  contact_phone  text
  contact_email  text                      all three customer-chosen
  starts_on      date                      optional stay window
  ends_on        date
  sent_at        timestamptz
  withdrawn_at   timestamptz
  supersedes     -> provider_notes(id)     a re-send points at what it replaces
```

`pet_label` and the contact fields are **denormalised on purpose**, the same
call `user_providers` already makes and for the same reason: the provider must
not need a join into `pets` or `auth.users` to render a note. That is what keeps
the read surface at one table. It also means the customer chooses even their own
contact detail, so nothing at all is disclosed implicitly.

### Policies

```
SELECT  is_pet_member(pet_id)
        OR (is_provider_member(provider_id) AND withdrawn_at IS NULL)
INSERT  is_pet_editor(pet_id) AND sent_by = auth.uid()
DELETE  is_pet_editor(pet_id)
UPDATE  revoked — see below
```

**One thing to get right: RLS cannot restrict which *columns* an UPDATE
touches.** "The customer may withdraw a note but not rewrite one already
delivered" is therefore not expressible as a policy — a `USING (is_pet_editor)`
UPDATE policy would let them rewrite `body` after the provider read it. So grant
no UPDATE at all and expose a `withdraw_provider_note(id)` RPC that sets
`withdrawn_at` and nothing else. This is the same trap `pet_owner_takeover.sql`
in this repo already documents from the other direction.

A second RPC, `onboarded_provider_ids(uuid[])`, answers "which of my providers
can be informed?" — needed because `provider_accounts` is not readable by a
customer, and it returns ids only, nothing about the account.

### Composing the draft — do not let a model invent a vaccination date

You asked for something "similar to the AI analysis". The existing
`health_summary` task is a good pattern, and the hook is cheap to add: `TASKS` in
`ai-complete.js` is a closed registry, prompts live server-side, cost is logged
to `api_usage`, and the 100-calls-a-month limit is **per task**, so a new
`provider_brief` would not eat the health summary's budget.

My recommendation is a split draft, not a single generated one:

- **The facts block is composed deterministically, in code, from the rows.**
  Latest vaccination per type with its date, allergies, current medicines,
  the boarding profile fields, the pet's basics. No model involved. Zero
  hallucination risk, zero cost, instant, and it renders the same way every time.
- **The covering note is the only generated text** — a few sentences of plain
  prose over facts that are already correct.

The reason to insist on this: a model restating a rabies date can get it wrong,
and the customer is the only check. People do not proofread machine text
carefully, especially text that looks authoritative and is about to be sent. A
wrong date in a note a boarder acts on is the one failure in this feature that
could hurt an animal. The facts are structured rows; there is no reason to put a
language model between them and a kennel.

Default facts block, for you to edit (section 6, decision 4):

- **In:** name, species, breed, age, latest vaccination per type with dates,
  allergies, current medicines with dose, the boarding profile (diet, feeding
  schedule, temperament, anxiety notes, triggers, handling, socialises with
  dogs), most recent medical record *title and date only*, vet name and phone.
- **Out:** bills, medical record detail or attachments, weight history,
  condition journal notes, reminders, documents.

This is now a **default**, not a boundary — the customer edits it before sending —
which is why it is a much lower-stakes decision than it was yesterday.

### 3.5 What this replaces, for the record

Three live-access models were considered and are now moot. Keeping the reasoning
so it is not re-derived:

- **Extend `pet_members` with provider rows** — near-zero work, because one
  function change would light up all eleven tables. Rejected: no time window, no
  depth control, and a `role='editor'` row would hand a boarder *write* access
  to a customer's medical record. One mistake in that function is a
  whole-directory leak.
- **A grant table plus additive RLS policies** — time-bounded and revocable, but
  RLS cannot express column depth, so a provider granted `pets` sees every column
  including free-text `notes`.
- **A grant table plus `SECURITY DEFINER` read RPCs** — what I recommended on
  2026-09-30. Sound, and follows the pattern `search_providers()` already sets,
  but it relies on every provider RPC remembering to call the gate first, and a
  function that forgets exposes everything. The inform note needs no such
  discipline because there is nothing to gate.

If a provider ever genuinely needs live data, that is the option to revisit —
but the note model should be given a real run first. It may turn out to be
sufficient, and it is strictly safer.

---

## 4. Scope

### Build (MVP)

| # | Feature | Notes |
|---|---|---|
| 1 | Provider sign-in at `/business` | drafted, needs applying and testing |
| 2 | Claim → admin approval | RPC drafted; **approval UI does not exist** |
| 3 | `onboarded_provider_ids()` + **Inform provider** button | gated on a claimed, approved listing |
| 4 | Draft → edit → send | deterministic facts, generated covering note |
| 5 | `provider_notes` + withdraw RPC | the whole provider-side read surface |
| 6 | Customer-side history under the pet | what was sent, to whom, when |
| 7 | Provider inbox: upcoming / current / past | grouped by the note's stay window |
| 8 | Notify the provider on send | one email or SMS through `_notify.js` |
| 9 | Broadcast to customers | provider → their customers, `_notify.js` |

Item 7 is the part worth noticing: because a note can carry an optional stay
window, **the provider dashboard you asked for falls out of the note model with
no booking system at all**. Notes with a future `starts_on` are upcoming, notes
spanning today are current, the rest are past. That was the thing the old plan
could not deliver in MVP.

### Defer, deliberately

- **1:1 in-app chat.** Largest item in the brief, least differentiated. A
  boarder who has the parent's number already messages them, and the app links
  out to WhatsApp today. Notes are one-way by design; keep them that way.
- **Provider → parent daily stay updates** (photo + note during a stay). The
  natural mirror of this feature and the emotional core of boarding, but it is a
  second direction with its own storage and notification work. Phase 6.
- **A general shared drive.** Nothing in the note model needs one, and a drive
  means quotas, scanning, retention and a second erasure path.
- **Provider-created bookings.** Keeps every provider write out of the schema.
- **Anything vet-specific.** You said vets have their own tooling, and
  `ProviderOnboarding.jsx` already takes this line: accept a vet claim to capture
  demand, build nothing for it.

---

## 5. Build order

**Phase 0 — unblock.** Put `is_admin()` into `supabase/`. Decide the admin model
(decision 1). Build the approval queue UI. Apply `provider_accounts.sql` and
record the boundary-test results in the file's own table.

**Phase 1 — the shell.** Deploy what is drafted. End-to-end proof: a real
boarder signs in, claims, is approved, sees their business name.

**Phase 2 — the note.** `provider_notes`, the withdraw RPC,
`onboarded_provider_ids()`. Verified by SQL boundary tests before any UI exists.

**Phase 3 — send.** The button, the draft, the edit-and-send sheet, the
customer-side history.

**Phase 4 — the inbox.** Provider side, grouped by stay window, with note age
shown.

**Phase 5 — broadcasts.** Provider → customers through `_notify.js`.

**Phase 6 — stay updates.** The return direction, if phases 1–5 land.

Phase 0 is still where the risk is. Phase 2 is now a single table instead of a
grant system across eleven, which is the main thing this revision buys.

---

## 6. Decisions I need from you

1. **Admin model** — keep one hardcoded email, or an `admins` table with a
   version-controlled `is_admin()`? *Recommendation: the table.* Not for
   security — for throughput. Provider onboarding otherwise stops whenever you
   are unavailable, and the current function cannot be rebuilt from this repo.

2. **Withdrawal.** Can a customer withdraw a sent note? *Recommendation: yes,
   soft — `withdrawn_at` set, the note disappears from the provider's inbox, the
   row is kept so the customer's own history stays honest.* And the UI should say
   plainly what withdrawal does and does not do: it removes their access going
   forward, it cannot unsee what was already read. Promising more than that would
   be a lie we built into a button.

3. **Staleness threshold.** At what age does a note get flagged in the
   provider's inbox? *Recommendation: show exact age always; flag past 30 days;
   and prompt the customer to re-send if they open an old note's pet.* Your call
   on the number — it depends on how long a typical gap between stays is, which
   you know and I do not.

4. **The default facts block.** The list in section 3 is my proposal. Lower
   stakes than it was, since the customer edits before sending, but it sets what
   most people will actually send. Say what you would move across the line — in
   particular whether "most recent medical record, title and date only" is right,
   or whether that should be out entirely.

5. **Does a note carry a stay window?** *Recommendation: yes, optional.* It is
   two date fields and it is what makes item 7 possible. The cost is one more
   thing on the send form.

6. **Re-send behaviour.** When a customer informs the same provider about the
   same pet again: supersede the old note, or keep both visible? *Recommendation:
   supersede, with the old one still reachable from the customer's history.* Two
   live notes with different vaccination dates is exactly the confusion the
   staleness risk is about.

---

## 7. What I did not check, and why

- **I did not run the drafted SQL**, against the live database or a branch. It is
  unapplied by design and applying it is a decision, not a step. Its
  boundary-test table is therefore still empty, which means the drafted policies
  are *reviewed*, not *verified*. Treat them that way. The same discipline
  applies to `provider_notes` when it is written: boundary tests before UI.
- **I did not open the provider shell in a browser.** It compiles and
  code-splits; I did not confirm it renders or that an OTP round trip works. The
  claim, approval and sign-in path is untested end to end.
- **I have not designed the send form's copy**, and it matters more than usual
  here: the customer is about to send medical facts to a business, and the
  screen is the only place that can set expectations about what happens to them
  afterwards.
- **I did not cost the notification fan-out.** Item 8 is one message per note and
  is negligible. Item 9 is not: a broadcast to a boarder's whole customer list
  goes out over Resend and Twilio, and Twilio SMS to Indian numbers is metered
  per message. Someone should put a number on a 100-customer broadcast before
  item 9 is built.
- **I did not measure what a generated covering note costs.** `_pricing.js` and
  `api_usage` already track this per task, so the answer is cheap to get once a
  `provider_brief` task exists — but note that the 100/month limit is per user
  per task, and a customer with six providers could reach it.
- **I did not look at whether `profiles` should get policies.** RLS is on with
  zero policies, so it is unreadable from the client, which is why the drafted
  code uses `provider_accounts` as its role source. That is the right call and
  needs no work; it is a standing oddity worth knowing about.
