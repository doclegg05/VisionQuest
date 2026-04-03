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

[`render.yaml`](/Users/brittlegg/visionquest/render.yaml) provisions:

- 1 web service named `visionquest`
- 3 cron services

  - `visionquest-appointment-reminders`
  - `visionquest-job-processor`
  - `visionquest-daily-coaching`

The web service runs:

```bash
npm run prisma:migrate:deploy && node .next/standalone/server.js
```

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
2. Create a private bucket named `uploads`.
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
3. Let Render read [`render.yaml`](/Users/brittlegg/visionquest/render.yaml).
4. Provide the required environment variables.
5. Confirm that all four services are created.

### Option B: Manual Web Service Plus Cron Jobs

If you do not use the blueprint:

1. Create a new Render web service.
2. Set:

   - Build command: `npm ci && npx prisma generate && npm run build`
   - Start command: `npm run prisma:migrate:deploy && node .next/standalone/server.js`
   - Health check path: `/api/health`

3. Create three cron jobs:

   - `node scripts/run-appointment-reminders.mjs`
   - `node scripts/run-job-processor.mjs`
   - `node scripts/run-daily-coaching.mjs`

4. Each cron service needs:

   - `APP_BASE_URL`
   - `CRON_SECRET`

## 5. Set Environment Variables

### Required

| Variable | Notes |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase Session pooler string |
| `DIRECT_URL` | Session pooler on Render unless direct host is reachable |
| `JWT_SECRET` | Hex secret |
| `TEACHER_KEY` | Gate for `/teacher-register` |
| `API_KEY_ENCRYPTION_KEY` | Base64-encoded 32-byte key |
| `APP_BASE_URL` | Public Render URL |
| `CRON_SECRET` | Shared secret for internal scheduled routes |
| `GEMINI_API_KEY` | Gemini credential |
| `STORAGE_ENDPOINT` | Supabase S3 endpoint |
| `STORAGE_REGION` | Usually `us-east-1` |
| `STORAGE_BUCKET` | `uploads` |
| `STORAGE_ACCESS_KEY` | Supabase storage access key |
| `STORAGE_SECRET_KEY` | Supabase storage secret key |

### Optional

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback URL |
| `GEMINI_MODEL` | Override default Gemini model |
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
2. If the problem is a migration, restore the database from backup because Prisma migrations are not automatically reversed.
