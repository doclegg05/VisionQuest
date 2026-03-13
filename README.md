# Visionquest

Visionquest is a Next.js portal for the SPOKES workforce development program. It gives students one place to work with Sage, track goals, complete orientation, manage certifications, store files, and build a portfolio. Teachers get dashboards for student progress and content management.

## Stack

- Next.js App Router
- React 19
- Prisma + PostgreSQL
- Google Gemini API
- Cloudflare R2 for production file storage

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

See [.env.example](/Users/brittlegg/visionquest/.env.example) for the full list.

- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `API_KEY_ENCRYPTION_KEY`
- `APP_BASE_URL`

## Optional Integrations

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GEMINI_API_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY`
- `R2_SECRET_KEY`
- `R2_BUCKET_NAME`

## Production Checklist

1. Provision PostgreSQL and run `npm run prisma:migrate:deploy`.
2. Set `JWT_SECRET`, `API_KEY_ENCRYPTION_KEY`, and `APP_BASE_URL` with production values.
3. Configure `GEMINI_API_KEY` if Sage should work without personal student keys.
4. Configure `SMTP_*` values if students should be able to reset passwords by email.
5. Configure Cloudflare R2 credentials if file uploads are enabled in production.
6. Whitelist the deployed Google OAuth callback URL in Google Cloud if Google sign-in is enabled.
7. Promote the first teacher account after that user registers:

   ```bash
   npm run users:promote-teacher -- <student-id-or-email>
   ```

8. Verify a student can register, reset a password, open Sage, upload a file, and save a portfolio item.
9. Run:

   ```bash
   npm run lint
   npm run build
   ```

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run prisma:generate`
- `npm run prisma:migrate:deploy`
- `npm run users:promote-teacher -- <student-id-or-email>`
