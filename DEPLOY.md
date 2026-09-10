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

Render dashboard note:

- Paste raw values without extra quotes.
- Use normal environment variables rather than Render Secret Files.

Local AI note:

- Student and staff Sage chat can be forced to the local Ollama provider for protected data.
- If the local endpoint is protected by Cloudflare Access, set the service-token values in Render env vars or in Program Setup. Env vars are preferred for production because they survive database secret-encryption-key drift.
- The local host must run Ollama, `scripts/ollama-relay.mjs`, and `cloudflared` as auto-starting services. Use `scripts/install-local-ai-services.ps1` from an elevated PowerShell on the local AI host.

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
