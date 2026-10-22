# Deployment Runbook — VisionQuest

This runbook covers the supported production path: Render for app hosting plus Supabase for PostgreSQL and file storage.

## Prerequisites

- GitHub repo: `https://github.com/doclegg05/VisionQuest.git`
- Supabase project
- Render account
- Google AI Studio account for Gemini
- Optional Google Cloud project for OAuth
- Optional SMTP provider for password reset mail
- Optional Sentry project

## Production Topology

[`render.yaml`](./render.yaml) declares one Starter web service. Scheduled work runs in Supabase `pg_cron`/`pg_net`; use the [cron runbook](./docs/plans/pg-cron-setup-runbook.md) to verify registrations and HTTP outcomes. The scripts in `scripts/run-*-*.mjs` are diagnostic helpers, not separate Render cron services.

The existing service was inspected on September 10, 2026:

| Setting | Render dashboard | Tracked blueprint |
| --- | --- | --- |
| Branch | `main` | Repository selected at creation |
| Build | `npm install; npm run build` | `npm ci && npx prisma generate && npm run build` |
| Start | `npm run prisma:migrate:deploy && npm start` | `npm run prisma:migrate:deploy && node .next/standalone/server.js` |
| Health check | Unset | `/api/health` |
| Retrieval abstention | Environment override absent; code defaults to 1 | `SAGE_RAG_ABSTAIN_DISTANCE=0.40` |
| Agent mode | Both mode/legacy overrides absent; current code resolves to `full` | `readonly` |

These are observed differences, not instructions to change agent permissions. A repository YAML value is not proof that the existing service uses it. Record actual values during release verification and update this snapshot after applying reviewed configuration changes. `npm start` uses `scripts/start-production.mjs`, which selects the standalone server when present.

## 1. Provision Supabase

### Database

1. Create a Supabase project.
2. In Supabase, open `Project Settings -> Database`.
3. Copy the Session pooler connection string and use it for `DATABASE_URL`.
4. If Render cannot reach the direct database host, also use the Session pooler string for `DIRECT_URL`.
5. In SQL Editor, ensure the app schema exists:

```sql
CREATE SCHEMA IF NOT EXISTS visionquest;
```

### Storage

1. Open `Storage`.
2. Use the existing private bucket named `Uploads` (case-sensitive). For a new project, create that bucket and set `STORAGE_BUCKET` to its exact name.
3. Open the S3 connection settings.
4. Record:

   - `STORAGE_ENDPOINT`
   - `STORAGE_BUCKET`
   - `STORAGE_ACCESS_KEY`
   - `STORAGE_SECRET_KEY`

5. Use `us-east-1` for `STORAGE_REGION` unless your storage configuration requires otherwise.

## 2. Create Secrets

Run locally:

```bash
openssl rand -hex 32
openssl rand -base64 32 | tr -d '\n'
openssl rand -base64 32 | tr -d '\n'
```

Use the outputs for:

- `JWT_SECRET`
- `TEACHER_KEY`
- `API_KEY_ENCRYPTION_KEY`

## 3. Get Third-Party Credentials

### Gemini

1. Go to `https://aistudio.google.com/app/apikey`
2. Create an API key
3. Store it as `GEMINI_API_KEY`

### Optional OAuth

If you want Google sign-in:

1. Create a Google OAuth web client
2. Add the callback URL:

```text
https://your-app.onrender.com/api/auth/google/callback
```

3. Save:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

### Optional email

If students need self-serve password reset by email, collect:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### Optional Sentry

If you want error reporting:

- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`

## 4. Deploy To Render

### Option A: Blueprint

This is the preferred path.

1. In Render, create a new Blueprint.
2. Connect the GitHub repository.
3. Let Render read [`render.yaml`](./render.yaml).
4. Provide the required environment variables.
5. Confirm that the web service is created and its effective settings match the intended blueprint. Verify Supabase schedules separately using the cron runbook.

### Option B: Manual Web Service

If you do not use the blueprint:

1. Create a new Render web service.
2. Set:

   - Build command: `npm ci && npx prisma generate && npm run build`
   - Start command: `npm run prisma:migrate:deploy && node .next/standalone/server.js`
   - Health check path: `/api/health`

3. Configure Supabase schedules through the [cron runbook](./docs/plans/pg-cron-setup-runbook.md), including its URL/secret prerequisites and outcome checks. Do not add duplicate Render cron services.
4. Set the intended non-secret runtime flags explicitly, including `SAGE_RAG_ABSTAIN_DISTANCE=0.40`. Preserve the authorized agent mode; changing retrieval configuration does not authorize additional tools.

## 5. Set Environment Variables

### Required

| Variable | Notes |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase Session pooler string |
| `DIRECT_URL` | Session pooler on Render unless direct host is reachable |
| `JWT_SECRET` | Hex secret, at least 32 characters (the boot probe refuses shorter) |
| `ADMIN_DATABASE_URL` | Connection string for the RLS-bypassing `postgres` role, used by `prismaAdmin` (crisis notifications, nudges, SMS webhook). **Required since 2026-09-07: a production boot without it is refused by `src/lib/boot-probes.ts`**, so a deploy fails to start rather than running with the admin client silently demoted to `vq_app`. |
| `RLS_CONTEXT_INJECTION` | Must be the exact string `true`. **Required since 2026-09-07 (same boot probe)**: anything else runs every query with no session context, and the staff-scoping policies enforce nothing. |
| `TEACHER_KEY` | Gate for `/teacher-register` |
| `API_KEY_ENCRYPTION_KEY` | Base64-encoded 32-byte key |
| `APP_BASE_URL` | Public Render URL |
| `CRON_SECRET` | Shared secret for internal scheduled routes |
| `GEMINI_API_KEY` | Gemini credential |
| `STORAGE_ENDPOINT` | Supabase S3 endpoint |
| `STORAGE_REGION` | Usually `us-east-1` |
| `STORAGE_BUCKET` | `Uploads` (existing private bucket; case-sensitive) |
| `STORAGE_ACCESS_KEY` | Supabase storage access key |
| `STORAGE_SECRET_KEY` | Supabase storage secret key |

### Optional

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback URL |
| `GEMINI_MODEL` | Override default Gemini model |
| `SAGE_AGENT_ENABLED` | Enable Sage tool calls and server-driven slash commands |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service-token client id for the local Sage AI endpoint |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service-token client secret for the local Sage AI endpoint |
| `AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_ID` | Explicit alias for `CF_ACCESS_CLIENT_ID` |
| `AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_SECRET` | Explicit alias for `CF_ACCESS_CLIENT_SECRET` |
| `SMTP_HOST` | Password reset mail |
| `SMTP_PORT` | Password reset mail |
| `SMTP_USER` | Password reset mail |
| `SMTP_PASS` | Password reset mail |
| `SMTP_FROM` | Password reset mail sender |
| `TWILIO_ACCOUNT_SID` | SMS notifications |
| `TWILIO_AUTH_TOKEN` | SMS notifications |
| `TWILIO_FROM_NUMBER` | SMS notifications |
| `SENTRY_DSN` | Server error tracking |
| `NEXT_PUBLIC_SENTRY_DSN` | Client error tracking |
| `LOG_LEVEL` | Logging verbosity |
| `COHORT_DEMO_MODE` | `true` opens the sign-in page to demo students and a shared demo instructor. See [Cohort demo mode](#cohort-demo-mode) |

Render dashboard note:

- Paste raw values without extra quotes.
- Use normal environment variables rather than Render Secret Files.

Local AI note:

- Student and staff Sage chat can be forced to the local Ollama provider for protected data.
- If the local endpoint is protected by Cloudflare Access, set the service-token values in Render env vars or in Program Setup. Env vars are preferred for production because they survive database secret-encryption-key drift.
- The local host must run Ollama, `scripts/ollama-relay.mjs`, and `cloudflared` as auto-starting services. Use `scripts/install-local-ai-services.ps1` from an elevated PowerShell on the local AI host.
- The installer sets `OLLAMA_CONTEXT_LENGTH=8192` on the Ollama service. Sage's chat calls use Ollama's `/v1` endpoint, which ignores the app's `num_ctx`, so without it a host with less than 24 GiB of VRAM loads models at 4,096 tokens and silently cuts the front off Sage's 7,000 to 7,500-token prompt, guardrails included. After one chat turn, `ollama ps` on the host must show `8192` in the CONTEXT column. A host set up before 2026-10-15 needs the installer re-run. Keep the value equal to `OllamaProvider.DEFAULT_NUM_CTX`, or to `ai_provider_num_ctx` if Program Setup overrides it (`-ContextLength <n>`). Details are in `docs/plans/2026-07-02-local-ai-operator-runbook.md`.

## 6. First-Run Data Setup

After the app is live, seed baseline data if your environment is empty:

```bash
DATABASE_URL="..." node scripts/seed-data.mjs
DATABASE_URL="..." node scripts/seed-documents.mjs
```

## 7. Create The First Teacher

Preferred path:

1. Set `TEACHER_KEY`.
2. Share it only with authorized staff.
3. Have the teacher register at `/teacher-register`.

Fallback path:

```bash
DATABASE_URL="..." node scripts/promote-teacher.mjs <email-or-student-id>
```

## 8. Verification Checklist

### Service health

- `GET /api/health` returns 200
- Web service boots without migration failure
- All three cron jobs show successful runs

### Student flow

- Student can register and sign in
- Student can open Sage and receive a streamed response
- Admin `Program Setup -> AI Provider -> Test Connection` succeeds if Sage is using local AI
- Goal extraction runs after chat
- Orientation loads
- File upload succeeds
- Portfolio creation succeeds
- Certifications page loads

### Teacher flow

- Teacher can sign in
- Teacher dashboard loads
- Intervention queue loads
- Student detail page loads
- Teacher can review student goals or certifications

### Optional integrations

- Password reset mail sends if SMTP is configured
- Google OAuth callback works if enabled
- Sentry receives test errors if configured

## 9. Monitoring And Recovery

### Health check

```bash
curl https://your-app.onrender.com/api/health
```

### Logs

- Use the Render dashboard for web and cron service logs
- Use Supabase logs for database and storage issues
- Use Sentry for client and server exception tracking if enabled

### Backups

Supabase handles managed backups. For manual export:

```bash
pg_dump "DIRECT_URL" --schema=visionquest > backup.sql
```

Restore:

```bash
psql "DIRECT_URL" < backup.sql
```

### Rollback

1. Roll back the service in Render to the last healthy deploy.
2. Verify whether the prior application is compatible with the current schema. Additive retrieval changes normally need only an application/configuration rollback. Investigate migration failures before selecting a database recovery procedure; a wholesale restore can discard unrelated live writes.

## Cohort demo mode

For the AI Leadership Academy cohort (Oct 15 to Dec 18, 2026). With the switch on, the sign-in page keeps its username and password form and adds two buttons, "Explore as a student" and "Explore as an instructor". The student button makes a new mock student and opens the first-day welcome steps. The instructor button signs the visitor in to one shared demo instructor, who sees only the "Cohort Demo Class" and its students. Nothing is emailed or texted for a demo account.

This opens the site to anyone with the link, so turn it on only while every record in the live database is mock data. That was true on 2026-10-19.

### Turn it on

1. Open the Render dashboard and select the VisionQuest web service.
2. Open **Environment** and choose **Add Environment Variable**.
3. Set the key to `COHORT_DEMO_MODE` and the value to `true`. Paste the value without quotes.
4. Save, and let Render deploy.
5. Open https://visionquest.onrender.com and check that both demo buttons show. Click each one. The student button opens the welcome steps with a privacy note, and the instructor button shows that new student in the demo class.

The switch is read when each request arrives, so it needs a restart and no rebuild. The value `true` turns it on, and capital letters or spaces around it do not matter. Any other value, or no variable, leaves it off.

While it is on, Google sign-in and the "Staff? Register here" link are hidden. Staff sign in with their own username and password.

### Limits

The defaults need no setup. Raise or lower them by adding any of these in the same **Environment** page. Each value is a whole number of 1 or more. A value that is not a valid number is ignored, the default applies, and one warning is logged with the variable name.

| Variable | Default | What it limits |
|----------|---------|----------------|
| `COHORT_DEMO_STUDENTS_PER_HOUR` | 40 | New demo students started on the whole site in one hour |
| `COHORT_DEMO_STUDENTS_PER_DAY` | 200 | New demo students started on the whole site in one UTC day |
| `COHORT_DEMO_SAGE_PER_DAY` | 2000 | Sage messages sent by all demo accounts together in one UTC day |

Two limits are fixed in code. One network can start 10 new demo students an hour, which only slows repeat clicks because the address comes from a header the caller controls. The shared demo instructor can send 300 Sage messages an hour and 1,000 a day. A visitor past any limit sees a plain message asking them to try again later.

### Turn it off after Dec 18, 2026

1. Open the VisionQuest web service in the Render dashboard, then **Environment**.
2. Delete `COHORT_DEMO_MODE`. Delete the three limit variables too if you added them.
3. Save, and let Render deploy.
4. Open the sign-in page and check that the demo buttons are gone and the Google block is back.

After that, the demo endpoints answer 404, and any demo session that is still open stops working on its next request. Demo accounts have no password, so nobody can sign in to one again. The demo students, the demo instructor and the "Cohort Demo Class" stay in the database until someone deletes them, which this change does not do.

### Reset the fictional roster (owner operation)

The reset tool defaults to a preview and never deletes student records. It archives and disables marked demo students in the owned demo class, invalidates their sessions and the shared instructor session, and frees the four starter login slots. On the next server start and demo entry, bootstrap creates fresh starter students. Historical chats, goals, files and audit records remain attached to the archived rows. Instructor settings and shared program content are unchanged. Daily usage counters are not cleared.

1. Turn demo mode off in Render and wait for the deployment to finish on every instance.
2. Run from this checkout with `ADMIN_DATABASE_URL` supplied securely in the environment (the script never loads `.env.local`):
   ```sh
   node --import tsx scripts/reset-demo-roster.ts
   node --import tsx scripts/reset-demo-roster.ts --apply --confirm-demo-disabled
   ```
3. Re-enable demo mode in Render and wait for the restart/deployment. The restart clears the bootstrap cache. Enter as the instructor and check the four fresh starter students.

The tool refuses a class not owned by the marked demo instructor, unmarked students in the demo roster, and selected students enrolled in another class. Preview reports counts only. Apply is transactional; any error rolls back all changes. Keep the switch off until the reset finishes. There is no reset endpoint available to public demo visitors. This is a roster reset, not deletion of demo history or instructor settings.

## Chat-First Rebuild (June 2026) — operational notes

- **Kill switches** (env vars, all default ON): `SAGE_AGENT_ENABLED=false` (agent tools),
  `SAGE_MEMORY_ENABLED=false` (memory extraction/retrieval), `SAGE_RAG_MODE=keyword`
  (revert to legacy retrieval). Retrieval tuning: `SAGE_RAG_DISTANCE_MARGIN` (0.02),
  `SAGE_RAG_MAX_DISTANCE` (0.55), `SAGE_RAG_MIN_SCORE_RATIO` (0.85),
  `SAGE_RAG_ABSTAIN_DISTANCE` (release setting 0.40; code default 1 leaves the filter effectively off), and `SAGE_MEMORY_DUP_DISTANCE` (0.08).
- **One-time after first deploy**: trigger the embedding backfill with one curl
  (idempotent; until then Sage uses keyword fallback):
  `curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill -H "Authorization: Bearer $CRON_SECRET"`
  Pass `-H "Content-Type: application/json" -d '{"force":true}'` to re-embed everything.
  (Local equivalent: `npm run sage:rag:backfill`.)
- **Optional**: set `COS_USER_ID` + `COS_API_TOKEN` (CareerOneStop) to activate the WV
  state-jobs adapter for local job feeds.
- All migrations are additive and apply automatically via `prisma migrate deploy`.
- E2E locally: `BASE_URL=http://localhost:3100 PORT=3100 npx playwright test` if port 3000
  is occupied (config honors BASE_URL/PORT).


### Demo Sage: local inference only

Public demo mode overrides the saved provider setting for the entire service,
including instructor, system, and background work. Generative requests use the
configured local endpoint and the pinned `gemma4:12b` model. Direct Gemini and
OpenRouter inference is refused before network access; `preferCloud` cannot
bypass the restriction. A local outage never falls back to a cloud model.

Set `COHORT_DEMO_LOCAL_ONLY=true` alongside `COHORT_DEMO_MODE=true` and retain it
when closing demo entry, so queued demo work remains protected. This safeguard
also applies to non-demo accounts on this service while either flag is true.
It does not alter the saved provider settings. Restoring ordinary cloud behavior
requires explicitly clearing both flags after demo jobs have drained.

Cloud embeddings are blocked without selecting another embedding model or
reindexing stored vectors. Document retrieval falls back to keyword search;
embedding-dependent memory work can remain pending or fail. Switching to local
embeddings requires a separately approved index migration.

The Render server must reach an authenticated, owner-approved endpoint for the
Mac's local model. Set `COHORT_DEMO_LOCAL_AI_ORIGIN` to that verified origin
(scheme, host, and optional port only), matching the configured provider URL.
Until it is explicitly pinned, demo inference fails before network access; the
saved legacy URL is not implicitly trusted. The origin pin is an operator trust
decision, not proof that an arbitrary remote server is local. A model listening on the Mac's loopback address alone is not
reachable from Render. Do not enable a new tunnel or change DNS as part of this
switch. Verify the existing transport separately; if it is unavailable, Sage
reports an outage while the portal remains usable. Hosted Ollama `:cloud` tags,
known cloud API endpoints, and HTTP redirects are refused in demo mode.
