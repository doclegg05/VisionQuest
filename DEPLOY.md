# Deployment Runbook — Visionquest

## Prerequisites

- GitHub repo: https://github.com/doclegg05/VisionQuest.git
- Supabase account (free tier works)
- Render account (Starter plan or above)
- Google AI Studio account (for Gemini API key)
- Supabase Storage enabled (same project — for file uploads)
- (Optional) Google Cloud project for OAuth
- (Optional) SMTP provider for password reset emails
- (Optional) Sentry project for error tracking

---

## Step 1: Provision Supabase Database

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Project Settings → Database**
3. Copy the **Connection string (URI)** — this is `DATABASE_URL`
   - Use the **Transaction (port 6543)** version with `?pgbouncer=true`
4. Copy the **Direct connection** string — this is `DIRECT_URL`
   - Uses port 5432, needed for Prisma migrations
5. Go to **SQL Editor** and run:
   ```sql
   CREATE SCHEMA IF NOT EXISTS visionquest;
   ```

## Step 2: Get Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create an API key (free tier: 60 requests/minute)
3. Save as `GEMINI_API_KEY`

## Step 3: Set Up Supabase Storage

1. In your Supabase project, go to **Storage** in the sidebar
2. Click **New bucket**, name it `uploads`, set it to **private**
3. Go to **Storage → S3 Connection** (or **Project Settings → API**)
4. Note your S3 endpoint: `https://<project-ref>.supabase.co/storage/v1/s3`
5. Generate S3 access keys — save the **Access Key ID** and **Secret Access Key**
6. Set these env vars:
   - `STORAGE_ENDPOINT` = the S3 endpoint above
   - `STORAGE_BUCKET` = `uploads`
   - `STORAGE_ACCESS_KEY` = the access key ID
   - `STORAGE_SECRET_KEY` = the secret key

## Step 4: Generate Secrets

Run locally:

```bash
# JWT signing secret
openssl rand -hex 32

# API key encryption key (base64-encoded 32 bytes)
openssl rand -base64 32
```

## Step 4: Deploy to Render

### Option A: Blueprint (recommended)

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New → Blueprint**
3. Connect the GitHub repo
4. Render reads `render.yaml` and creates the web service plus the hourly reminder cron service
5. Fill in the environment variables when prompted

### Option B: Manual

1. **New → Web Service** → connect GitHub repo
2. Settings:
   - **Build command**: `npm ci && npx prisma generate && npm run build`
   - **Start command**: `npm run prisma:migrate:deploy && npm start`
   - **Health check path**: `/api/health`
3. Add environment variables (see below)
4. Add a separate hourly cron job that runs:

```bash
node scripts/run-appointment-reminders.mjs
```

The cron job needs `APP_BASE_URL` and `CRON_SECRET`.

### Required Environment Variables

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase pooled connection string |
| `DIRECT_URL` | Supabase direct connection string |
| `JWT_SECRET` | Output of `openssl rand -hex 32` |
| `API_KEY_ENCRYPTION_KEY` | Output of `openssl rand -base64 32` |
| `APP_BASE_URL` | `https://your-app.onrender.com` |
| `GEMINI_API_KEY` | From Google AI Studio |
| `STORAGE_ENDPOINT` | Supabase S3 endpoint |
| `STORAGE_BUCKET` | `uploads` |
| `STORAGE_ACCESS_KEY` | Supabase S3 access key |
| `STORAGE_SECRET_KEY` | Supabase S3 secret key |

### Optional Environment Variables

| Variable | Purpose |
|----------|---------|
| `STORAGE_REGION` | S3 region (default: `us-east-1`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `https://your-app.onrender.com/api/auth/google/callback` |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (usually 587) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | `Visionquest <no-reply@yourdomain.com>` |
| `CRON_SECRET` | Shared secret for internal cron routes |
| `SENTRY_DSN` | Sentry DSN for server-side error tracking |
| `NEXT_PUBLIC_SENTRY_DSN` | Same DSN for client-side error tracking |

## Step 5: Run Migrations

Migrations run automatically on deploy via the start command. To run manually:

```bash
DATABASE_URL="..." npx prisma migrate deploy
```

## Step 6: Seed Initial Data

After the first deploy, seed orientation items, cert templates, and SPOKES checklist:

```bash
DATABASE_URL="..." node scripts/seed-data.mjs
```

## Step 7: Create First Teacher Account

1. Have the teacher register as a normal student at `/`
2. Promote them to teacher:

```bash
DATABASE_URL="..." node scripts/promote-teacher.mjs <email-or-student-id>
```

## Step 8: Configure Google OAuth (Optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create OAuth 2.0 credentials (Web application)
3. Add authorized redirect URI: `https://your-app.onrender.com/api/auth/google/callback`
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in Render

## Step 9: Verify Deployment

Run through the UAT checklist:

- [ ] Landing page loads at APP_BASE_URL
- [ ] Student can register with email/password
- [ ] Student can log in
- [ ] Student can open Sage and send a message
- [ ] Sage responds with streaming text
- [ ] Goals are extracted from conversation
- [ ] Student can view orientation checklist
- [ ] Student can upload a file
- [ ] Student can add a portfolio item
- [ ] Student can view certifications
- [ ] Teacher can log in and see class overview
- [ ] Teacher can view student detail page
- [ ] Teacher can verify a certification requirement
- [ ] Password reset email sends (if SMTP configured)
- [ ] Google OAuth works (if configured)
- [ ] Health check returns 200: `curl https://your-app.onrender.com/api/health`

---

## Database Backup & Recovery

### Supabase Backups

- **Free tier**: Daily backups, 7-day retention
- **Pro tier**: Point-in-time recovery (PITR)
- Backups are automatic — no configuration needed

### Manual Backup

```bash
pg_dump "DIRECT_URL" --schema=visionquest > backup.sql
```

### Restore

```bash
psql "DIRECT_URL" < backup.sql
```

---

## Monitoring

### Health Check

```bash
curl https://your-app.onrender.com/api/health
```

Returns:
```json
{
  "status": "healthy",
  "uptime": 12345.67,
  "db": "connected",
  "latency_ms": 12,
  "timestamp": "2026-03-13T..."
}
```

### Sentry

If configured, errors are automatically reported to your Sentry project. Check the Sentry dashboard for:
- Unhandled exceptions
- Performance metrics (trace sample rate: 10%)

### Render Logs

View real-time logs in the Render dashboard under your service → **Logs**.

---

## Rollback

1. In Render dashboard, go to **Events** → find the previous successful deploy
2. Click **Rollback** to revert to that version
3. If a database migration needs rollback, restore from backup (Supabase does not auto-rollback migrations)
