# Visionquest

Visionquest is a Next.js portal for the SPOKES workforce development program. It gives students one place to work with Sage, track goals, complete orientation, manage certifications, store files, and build a portfolio. Teachers get dashboards for student progress and content management.

## Stack

- Next.js App Router
- React 19
- Prisma + PostgreSQL
- Google Gemini API
- Supabase Storage (S3-compatible) or Cloudflare R2 for production file storage

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill in your values:

   ```bash
   cp .env.example .env.local
   ```

3. Generate the Prisma client and run migrations:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate:deploy
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

## Required Environment Variables

See [.env.example](./.env.example) for the full list.

- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `TEACHER_KEY`
- `API_KEY_ENCRYPTION_KEY`
- `APP_BASE_URL`

## Optional Integrations

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (defaults to `gemini-2.5-flash-lite`)
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `STORAGE_ENDPOINT`
- `STORAGE_BUCKET`
- `STORAGE_ACCESS_KEY`
- `STORAGE_SECRET_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY`
- `R2_SECRET_KEY`
- `R2_BUCKET_NAME`

## Production Checklist

1. Provision PostgreSQL and run `npm run prisma:migrate:deploy`.
2. If you deploy on Render with Supabase, use the Supabase **Session pooler** connection string for `DATABASE_URL`.
3. If Render cannot reach the Supabase direct host, set `DIRECT_URL` to the same Session pooler string until you have an IPv4-compatible direct connection.
4. Set `JWT_SECRET`, `TEACHER_KEY`, `API_KEY_ENCRYPTION_KEY`, and `APP_BASE_URL` with production values.
5. Configure `GEMINI_API_KEY` if Sage should work without personal student keys.
6. Configure `SMTP_*` values if students should be able to reset passwords by email.
7. Configure storage credentials if file uploads are enabled in production.
8. If you deploy on Render with [render.yaml](./render.yaml), the reminder cron service is provisioned automatically. Otherwise, schedule `node scripts/run-appointment-reminders.mjs` hourly with `APP_BASE_URL` and `CRON_SECRET`.
9. Whitelist the deployed Google OAuth callback URL in Google Cloud if Google sign-in is enabled.
10. Either:

    - set `TEACHER_KEY` and have teachers register at `/teacher-register`, or
    - promote the first teacher account after that user registers:

   ```bash
   npm run users:promote-teacher -- <student-id-or-email>
   ```

11. Verify a student can register, reset a password, open Sage, upload a file, and save a portfolio item.
12. Run:

   ```bash
   npm run lint
   npm run test
   npm run build
   ```

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:smoke` (boots a local dev server with smoke-safe env defaults; override `SMOKE_BASE_URL` if needed)
- `npm run prisma:generate`
- `npm run prisma:migrate:deploy`
- `npm run users:promote-teacher -- <student-id-or-email>`
