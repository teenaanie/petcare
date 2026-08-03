# MyPetCare — Setup Guide

## Quick Start (no accounts needed)

The app works out of the box with browser storage — no backend required to get started.

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev

# 3. Open http://localhost:5173
```

---

## Enable AI Document Scanning (OpenAI)

1. Go to [platform.openai.com](https://platform.openai.com) → sign up (free credits included)
2. Create an API key under **API Keys**
3. Add to `.env`:
   ```
   VITE_OPENAI_API_KEY=sk-...
   ```
4. Restart `npm run dev`

The scanner uses **GPT-4o** (vision model) to read images and PDFs of vet reports, vaccination certificates, and lab results, then automatically creates the right record type.

---

## Enable Email Reminders (EmailJS — free, 200 emails/month)

1. Sign up at [emailjs.com](https://www.emailjs.com)
2. Add an **Email Service** (Gmail, Outlook, etc.)
3. Create an **Email Template** with these variables:
   - `{{to_name}}` — recipient name
   - `{{to_email}}` — recipient email
   - `{{pet_name}}` — pet's name
   - `{{reminder_type}}` — e.g. Vaccination
   - `{{due_date}}` — formatted date
   - `{{notes}}` — additional notes
4. Add to `.env`:
   ```
   VITE_EMAILJS_SERVICE_ID=service_xxx
   VITE_EMAILJS_TEMPLATE_ID=template_xxx
   VITE_EMAILJS_PUBLIC_KEY=xxx
   ```

---

## WhatsApp Reminders

WhatsApp works **without any setup**. When you tap "Send WhatsApp" on a reminder, it opens WhatsApp Web (or the app on mobile) with a pre-filled message. The recipient just needs to have WhatsApp.

For automated WhatsApp (without manual tapping), you can later add Twilio's WhatsApp API — this requires a paid Twilio account.

---

## Connect a Real Database (Supabase — free tier)

For data that persists across devices and browsers:

1. Create a project at [supabase.com](https://supabase.com)
2. Run the SQL below in the Supabase SQL editor
3. Add to `.env`:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Replace `src/lib/storage.js` calls with the Supabase client from `src/lib/supabase.js`

### Supabase schema
```sql
create table pets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  species text,
  breed text,
  gender text,
  dob date,
  weight numeric,
  color text,
  microchip_id text,
  insurance_policy text,
  vet_name text,
  vet_phone text,
  vet_email text,
  notes text
);

create table medical_records (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  pet_id uuid references pets(id) on delete cascade,
  date date,
  type text,
  title text,
  description text,
  vet text,
  cost numeric
);

create table vaccinations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  pet_id uuid references pets(id) on delete cascade,
  name text,
  date_given date,
  next_due date,
  batch_number text,
  vet text,
  notes text
);

create table allergies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  pet_id uuid references pets(id) on delete cascade,
  allergen text,
  type text,
  severity text,
  reactions text[],
  notes text,
  diagnosed_date date
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  pet_id uuid references pets(id) on delete cascade,
  type text,
  due_date date,
  frequency text,
  email text,
  whatsapp text,
  notes text
);
```

---

## Deploy to the Web (free)

### Netlify
```bash
npm run build
# Drag the `dist/` folder to netlify.com/drop
```

### Vercel
```bash
npm install -g vercel
vercel
```

Both are free for personal projects.

---

## Turn into a Mobile App (later)

This React app can be wrapped into a mobile app using:
- **Capacitor** (iOS + Android, free) — `npm install @capacitor/core @capacitor/cli`
- **PWA** — add a manifest and service worker for "install to home screen"
