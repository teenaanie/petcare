# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pippy (product name shown in-app; repo/package name `mypetcare`) — a React SPA for tracking pet health records (medical history, vaccinations, allergies, medicines, weight, bills, reminders) plus a directory of pet service providers (vets, groomers, boarders, stores, etc.) that providers can self-register for. Deployed to Netlify with Netlify Functions as the backend glue and Supabase as the database/auth.

## Commands

```bash
npm run dev       # start Vite dev server (http://localhost:5173)
npm run build     # production build to dist/
npm run preview   # preview the production build
```

There is no lint or test setup/script in this repo — don't invent `npm run lint`/`npm test` commands.

Netlify Functions run locally via the Netlify CLI (`netlify dev`) if needed to exercise `/netlify/functions/*` — the Vite dev server alone does not serve them.

### Provider data import

```bash
node scripts/import-providers.mjs <path-to-apify-json> [--dry-run] [--limit N]
```

Transforms an Apify Google Maps scrape into `providers` rows and upserts on `place_id` (idempotent — safe to re-run). Requires `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` in `.env`.

## Architecture

### Data layer: `src/lib/storage.js` is the only place components should read/write data

Every entity (pets, medical_records, vaccinations, allergies, reminders, weight_logs, medicines, bills, providers) has a `get*`/`save*`/`delete*` function here. Each one branches on `isConfigured` (from `src/lib/supabase.js`, true when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set):

- **Configured**: reads/writes go to Supabase via `@supabase/supabase-js`.
- **Not configured**: falls back to `localStorage`, namespaced under `mypetcare_*` keys.

This means the app works fully offline/unauthenticated with zero setup, and upgrades to multi-device sync transparently once Supabase env vars are present — components never need to know which mode is active. When adding a new entity, follow the existing pattern: snake_case in Postgres, camelCase in JS, with `toSnake*`/`fromSnake*` converter pairs at the bottom of `storage.js`.

Provider search/paging/filtering (`getProviders`, `getProviderFacets`) intentionally happens server-side via Postgres RPCs (`search_providers`, `provider_facets` — defined in `supabase/providers_search.sql`), not by fetching everything and filtering in the browser — PostgREST caps responses at 1000 rows, so client-side filtering would silently drop providers as the table grows.

### Auth

Supabase phone-based auth (`PhoneAuth.jsx`), gated in `App.jsx`: if Supabase is configured and there's no session, the whole app renders `PhoneAuth` instead. Admin access is determined by exact email match (`ADMIN_EMAIL` constant in `App.jsx`) or a `profiles.is_admin` flag as fallback — checked client-side in `checkAdmin()`.

### App shell (`src/App.jsx`)

Single top-level component owning all navigation state (no router) — `selectedPet`, `activeTab`, `adminView`, `servicesView` control which of `PetList` / `PetDetail` / `AdminDashboard` / `ProviderDirectory` renders in `<main>`. `Sidebar` (desktop) and `MobileAppNav`/`MobileHeader` (mobile) both drive the same state setters.

### Netlify Functions (`netlify/functions/`) — server-only secrets and privileged operations

- **`analyze-document.js`**: proxies OpenAI vision (`gpt-4o-mini`) calls so the API key never reaches the browser. Authenticates the caller's Supabase JWT, enforces a per-user monthly scan limit (`api_usage` table, `MONTHLY_SCAN_LIMIT` env var, default 30), and logs token usage/estimated cost. The prompt (`buildPrompt()`) has detailed rules for parsing Indian vet documents (DD/MM/YYYY dates, distinguishing MFG/EXP from actual visit dates, extracting vaccines/medicines/bills/weight/abnormal lab values as structured JSON) — treat this prompt as load-bearing product logic, not boilerplate.
- **`register-provider.js`**: public endpoint for providers to self-list (always inserted with `is_approved=false`, reviewed in `AdminDashboard`). Has a honeypot field (`body.url`) and returns an identical success response to bots. Sends an admin notification email via Resend.
- **`morning-reminders.js`**: scheduled function (`export const config = { schedule: '30 1 * * *' }`, also mirrored in `netlify.toml`) running daily at 7:00 AM IST. Finds reminders due today, groups by pet, and sends email (Resend) + SMS (Twilio) + web push (`web-push` + VAPID keys) — each channel is independently optional based on which env vars are set, logging what it would have sent when a channel isn't configured. Logs each run to `agent_runs`.

All three functions create their own service-role Supabase client (`SUPABASE_SERVICE_KEY`, never exposed client-side) rather than reusing `src/lib/supabase.js`, which uses the anon key.

### Database (`supabase/*.sql`)

Plain SQL files meant to be run manually in the Supabase SQL editor (no migration tool/CLI wired up). Files are additive and safe to re-run (`CREATE OR REPLACE FUNCTION`, etc.):
- `pet_members.sql` — pet sharing/multi-user access
- `providers_search.sql` / `providers_enrichment.sql` — provider directory search RPCs and enrichment
- `push_notifications.sql` — `push_subscriptions` table for web push

Base tables (`pets`, `medical_records`, `vaccinations`, `allergies`, `reminders`, `weight_logs`, `medicines`, `bills`) are documented as `CREATE TABLE` statements in [SETUP.md](SETUP.md) rather than in `supabase/`.

### Environment variables

Client-side (must be prefixed `VITE_`, read via `import.meta.env`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_OPENAI_API_KEY` (legacy/unused now that scanning is proxied — see below), `VITE_EMAILJS_*`.

Server-side only (Netlify Functions, `process.env`, never `VITE_`-prefixed): `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MONTHLY_SCAN_LIMIT`, `RESEND_API_KEY`, `FROM_EMAIL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Keep this split intact — the whole point of `analyze-document.js` is that the OpenAI key stays server-side.

### PWA

`public/manifest.json` + `public/sw.js` (service worker) + `InstallPrompt.jsx` make the app installable, including on iOS where the install flow has to be surfaced manually (no native install prompt).
