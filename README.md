# NORA

**Tell me once. I'll remember.** · *Spune-mi o dată. Eu țin minte.*

NORA is a proactive, voice-first personal assistant. You say what you need to do once; NORA
understands it, stores it as a real task, reminds you at the right moment, checks whether it got
done and follows up until the loop is closed.

## Architecture

```
apps/web                      Preact + TypeScript PWA (voice UI, Activity, Profile) – ~60 KB gzip first load
packages/core                 Shared domain logic (pure TS, runs in browser, Node tests and Deno):
                                parsing (ro/en/it/ru), task state machine, recurrence (RRULE subset),
                                reminder strategy, AI plan schema + validation, conversation engine
supabase/migrations           Postgres schema, Row Level Security, idempotency, pg_cron schedule
supabase/functions/api        HTTP API v1 (chat, voice, tasks, profile, memory, devices, privacy)
supabase/functions/dispatch   Every minute: sends due reminders (Web Push), follow-ups, missed/recurring sweep
```

Principles the code follows (see the product spec):

- **The AI never writes to the database.** The model returns a JSON plan → validated in
  `core/ai.ts` → executed deterministically by `TaskService` → saved → *then* NORA confirms,
  using the saved data. If saving fails, NORA says so.
- **Fast path without AI.** Answers to NORA's own questions ("9", "vineri", "gata",
  "nu mai trebuie") are resolved locally by `core/parse.ts` – no LLM call, no latency, no loops.
- **Database is the source of truth.** "Ce am mâine?" is answered from stored tasks, never from the model.
- **Durable reminders.** Reminders are rows in Postgres, claimed atomically by the dispatcher
  (`claim_due_reminders`, `SKIP LOCKED`). Restarts or a closed app lose nothing.
- **Silence never becomes text.** Voice activity detection on the device (nothing is uploaded
  without speech) + a server-side transcript guard against Whisper hallucinations.
- **Replaceable providers.** `AIProvider` (Groq `openai/gpt-oss-120b` today),
  `SpeechToTextProvider` (Groq `whisper-large-v3`), `TTSProvider` (browser voice today).
- **Privacy.** RLS on every table; users can view/edit/delete memory, export all data, delete the account.
- **Global from day one.** UI in en/ro/it/ru via a real i18n layer; the conversation language is
  detected per message and is independent from the UI language; locale-aware dates/times; timezone-aware
  scheduling (floating vs absolute times, travel between timezones).
- **Brand in one place.** `apps/web/src/config/brand.ts` (name, tagline, URLs, feature flags).

## Development

```bash
npm install
npm test                 # unit + conversation tests (spec tests A–J included)
npm run typecheck        # core + web
npm run functions:check  # Deno typecheck of the edge functions
npm run test:e2e         # production build + Chromium end-to-end tests
npm run dev              # web app on http://localhost:5173 (needs apps/web/.env)
```

## Deploy

1. **Supabase project** – create one for NORA and link it: `supabase link --project-ref <ref>`.
2. **Database** – `supabase db push` (applies `supabase/migrations`).
3. **Secrets** – copy `supabase/functions/.env.example` → `.env`, fill in `GROQ_API_KEY`,
   VAPID keys (`npm run vapid`) and a random `CRON_SECRET`, then
   `supabase secrets set --env-file supabase/functions/.env`.
4. **Cron** – in the SQL editor:
   `select vault.create_secret('https://<ref>.supabase.co', 'nora_project_url');`
   `select vault.create_secret('<CRON_SECRET>', 'nora_cron_secret');`
5. **Functions** – `npm run functions:deploy`.
6. **Auth** – enable Email sign-in; in *Auth → Email templates → Magic Link* include `{{ .Token }}`
   so users get a 6-digit code (works inside the installed app). Add the app URL to the redirect URLs.
7. **Web** – `apps/web/.env` from `.env.example` (public URL + anon key only), `npm run build`,
   host `apps/web/dist` on any static host with SPA fallback to `index.html`.

## Status

Implemented end-to-end: text & voice conversation → task → Activity → persistence → reminder
scheduling → push notification with actions (done / snooze / not yet) → follow-up question in
the conversation → complete / snooze / reschedule / cancel / delete → recurring tasks →
questions answered from the database → profile, preferences, memory and privacy controls.

Next: native iOS/Android shells (the API and `packages/core` are client-agnostic), a neural TTS
provider, calendar / maps / contacts integrations, location-based reminders.
