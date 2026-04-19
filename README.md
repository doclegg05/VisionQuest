# VisionQuest

VisionQuest is an AI-coach-driven portal for the SPOKES workforce development program. It gives students a single place to work with Sage, track goals, complete orientation, manage certifications, save files, build a portfolio, and explore jobs. Teachers get class operations, student progress views, intervention tooling, and reporting workflows.

## What the App Covers

- Student experience centered around Sage, goals, orientation, certifications, portfolio, files, resources, and job exploration
- Teacher operations for rosters, student detail, interventions, advising, forms, reports, and content management
- Background workflows for appointment reminders, job processing, and daily coaching prompts
- AI-assisted coaching and extraction flows powered by Google Gemini

## Stack

- Next.js 16 App Router
- React 19
- TypeScript 5
- Prisma 6 with PostgreSQL
- Supabase PostgreSQL and Supabase Storage (S3-compatible)
- Google Gemini 2.5 Flash Lite by default
- Tailwind CSS 4
- Sentry for optional error tracking

## Architecture At A Glance

- Auth uses JWTs stored in `httpOnly` cookies with SameSite strict protection
- Passwords use PBKDF2-SHA512 hashing; OAuth users now store `null` password hashes
- Student routes live under [`src/app/(student)`](/Users/brittlegg/visionquest/src/app/(student))
- Teacher routes live under [`src/app/(teacher)`](/Users/brittlegg/visionquest/src/app/(teacher))
- API routes live under [`src/app/api`](/Users/brittlegg/visionquest/src/app/api)
- Sage chat streams responses from `/api/chat/send` and runs a follow-up extraction pass asynchronously
- Files write to local `./uploads/` in development and to Supabase Storage in production
- CSP and request hardening are enforced in [`src/proxy.ts`](/Users/brittlegg/visionquest/src/proxy.ts)

For a fuller repo walkthrough, see [`docs/DEVELOPER_GUIDE.md`](/Users/brittlegg/visionquest/docs/DEVELOPER_GUIDE.md).

## Repository Map

- [`src/app`](/Users/brittlegg/visionquest/src/app) App Router pages, layouts, and API routes
- [`src/components`](/Users/brittlegg/visionquest/src/components) UI grouped by product area
- [`src/lib`](/Users/brittlegg/visionquest/src/lib) business logic, integrations, progression, auth, and testable services
- [`prisma/schema.prisma`](/Users/brittlegg/visionquest/prisma/schema.prisma) database schema
- [`scripts`](/Users/brittlegg/visionquest/scripts) operational scripts, smoke tests, seeding, and promotion helpers
- [`docs`](/Users/brittlegg/visionquest/docs) product guidance, plans, and implementation references
- [`DEPLOY.md`](/Users/brittlegg/visionquest/DEPLOY.md) deployment runbook for Render and Supabase

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create local environment config

```bash
cp .env.example .env.local
```

Fill in the required variables from the next section. For local-only work, you can leave optional integrations blank.

### 3. Generate Prisma client and apply migrations

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

### 4. Start the app

```bash
npm run dev
```

Open `http://localhost:3000`.

### 5. Optional local seed helpers

```bash
npm run db:seed
npm run db:seed-documents
```

Use these when you want local orientation data, template records, or seeded grounding documents.

## Environment Variables

See [`/.env.example`](/Users/brittlegg/visionquest/.env.example) for the authoritative template and inline generation notes.

### Required for local development

- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `TEACHER_KEY`
- `API_KEY_ENCRYPTION_KEY`
- `APP_BASE_URL`

### Required for production features

- `CRON_SECRET` for internal scheduled routes
- `GEMINI_API_KEY` for Sage without per-user key entry
- `STORAGE_ENDPOINT`
- `STORAGE_BUCKET`
- `STORAGE_ACCESS_KEY`
- `STORAGE_SECRET_KEY`

### Optional integrations

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GEMINI_MODEL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `LOG_LEVEL`

## Development

- `npm run cleanup:worktrees` — Reap stale worktrees left by parallel Claude Code agent runs.

## Common Commands

### App lifecycle

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`

### Tests

- `npm run test`
- `npm run test:api`
- `npm run test:smoke`
- `npm run test:smoke:api`
- `npm run test:e2e`

### Database and user operations

- `npm run prisma:generate`
- `npm run prisma:migrate:deploy`
- `npm run db:seed`
- `npm run db:seed-documents`
- `npm run users:promote-teacher -- <student-id-or-email>`
- `npm run users:promote-admin -- <student-id-or-email>`

## Recommended Verification Before Shipping

Run the minimum engineering checks:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

For UI or integration-sensitive changes, also run:

```bash
npm run test:smoke
npm run test:e2e
```

## Deployment

VisionQuest is configured for Render plus Supabase. The blueprint file in [`render.yaml`](/Users/brittlegg/visionquest/render.yaml) provisions:

- 1 web service
- 3 cron services

  - appointment reminders
  - job processor
  - daily coaching

Use [`DEPLOY.md`](/Users/brittlegg/visionquest/DEPLOY.md) for the full deployment runbook.

## Product And Planning Docs

- [`docs/PRODUCT_GUIDE.md`](/Users/brittlegg/visionquest/docs/PRODUCT_GUIDE.md) product intent, user model, and current gaps
- [`docs/PRODUCT_DECISIONS.md`](/Users/brittlegg/visionquest/docs/PRODUCT_DECISIONS.md) scope authority and current decisions
- [`docs/ACADEMIC_EFFECTIVENESS_ROADMAP.md`](/Users/brittlegg/visionquest/docs/ACADEMIC_EFFECTIVENESS_ROADMAP.md) learning and evidence strategy
- [`CLAUDE.md`](/Users/brittlegg/visionquest/CLAUDE.md) project operating rules and doc-routing instructions for agents
