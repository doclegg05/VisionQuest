# VisionQuest Developer Guide

This guide is the shortest path to understanding how the project is laid out and where to make changes.

## Product Shape

VisionQuest serves two primary audiences:

- Students working through coaching, goals, orientation, credentials, files, portfolio, and job readiness
- Teachers managing classes, interventions, student progress, advising, and reporting

Sage is the AI coach that powers conversational workflows and downstream goal extraction.

## Main Code Areas

### App routes

- [`src/app/(student)`](/Users/brittlegg/visionquest/src/app/(student)) student-facing pages
- [`src/app/(teacher)`](/Users/brittlegg/visionquest/src/app/(teacher)) teacher-facing pages
- [`src/app/(admin)`](/Users/brittlegg/visionquest/src/app/(admin)) admin-only surfaces
- [`src/app/api`](/Users/brittlegg/visionquest/src/app/api) server routes for auth, chat, files, goals, teacher tools, jobs, reports, and cron endpoints

### Components

- [`src/components/chat`](/Users/brittlegg/visionquest/src/components/chat) Sage conversation UI
- [`src/components/goals`](/Users/brittlegg/visionquest/src/components/goals) goal and planning interfaces
- [`src/components/files`](/Users/brittlegg/visionquest/src/components/files) student file management
- [`src/components/portfolio`](/Users/brittlegg/visionquest/src/components/portfolio) portfolio authoring
- [`src/components/resources`](/Users/brittlegg/visionquest/src/components/resources) resource library
- [`src/components/teacher`](/Users/brittlegg/visionquest/src/components/teacher) teacher dashboards and workflows
- [`src/components/teacher/student-detail`](/Users/brittlegg/visionquest/src/components/teacher/student-detail) tabbed student-detail subviews

### Business logic

- [`src/lib/auth.ts`](/Users/brittlegg/visionquest/src/lib/auth.ts) auth helpers and session behavior
- [`src/lib/gemini.ts`](/Users/brittlegg/visionquest/src/lib/gemini.ts) Gemini model configuration
- [`src/lib/storage.ts`](/Users/brittlegg/visionquest/src/lib/storage.ts) local versus S3-compatible file storage
- [`src/lib/progression`](/Users/brittlegg/visionquest/src/lib/progression) readiness and progression engine
- [`src/lib/sage`](/Users/brittlegg/visionquest/src/lib/sage) prompts, coaching arcs, extraction, and Sage support logic
- [`src/lib/job-board`](/Users/brittlegg/visionquest/src/lib/job-board) job source adapters, recommendation, and parsing

### Persistence and operations

- [`prisma/schema.prisma`](/Users/brittlegg/visionquest/prisma/schema.prisma) schema source of truth
- [`prisma/migrations`](/Users/brittlegg/visionquest/prisma/migrations) migration history
- [`scripts`](/Users/brittlegg/visionquest/scripts) seed jobs, cron launchers, smoke checks, and admin promotion scripts

## Core Runtime Flows

### Authentication

- Session auth uses JWTs in `httpOnly` cookies
- CSRF protections validate request origin for mutating `/api/*` routes
- Teacher self-registration is intentionally gated by `TEACHER_KEY`
- Google OAuth is optional and can coexist with password auth

### Sage chat

- The main chat endpoint is `/api/chat/send`
- Responses stream over SSE
- Goal extraction runs as a second pass after the chat response is initiated
- Prompting and personality rules live under [`src/lib/sage`](/Users/brittlegg/visionquest/src/lib/sage)

### Storage

- Development defaults to local uploads
- Production is designed around Supabase Storage using its S3-compatible endpoint
- Older Cloudflare R2 support remains as a fallback path when `STORAGE_*` variables are absent

### Background work

`render.yaml` provisions three cron services:

- appointment reminders
- job processor
- daily coaching

The corresponding scripts live in [`scripts/run-appointment-reminders.mjs`](/Users/brittlegg/visionquest/scripts/run-appointment-reminders.mjs), [`scripts/run-job-processor.mjs`](/Users/brittlegg/visionquest/scripts/run-job-processor.mjs), and [`scripts/run-daily-coaching.mjs`](/Users/brittlegg/visionquest/scripts/run-daily-coaching.mjs).

## How To Navigate By Task

### I need to change a student workflow

Start with:

- [`src/app/(student)`](/Users/brittlegg/visionquest/src/app/(student))
- the relevant feature folder under [`src/components`](/Users/brittlegg/visionquest/src/components)
- supporting logic in [`src/lib`](/Users/brittlegg/visionquest/src/lib)

### I need to change a teacher dashboard or intervention flow

Start with:

- [`src/app/(teacher)`](/Users/brittlegg/visionquest/src/app/(teacher))
- [`src/components/teacher`](/Users/brittlegg/visionquest/src/components/teacher)
- teacher APIs under [`src/app/api/teacher`](/Users/brittlegg/visionquest/src/app/api/teacher)

### I need to change readiness, progression, or scoring

Start with:

- [`src/lib/progression/fetch-readiness-data.ts`](/Users/brittlegg/visionquest/src/lib/progression/fetch-readiness-data.ts)
- [`src/lib/progression/engine.ts`](/Users/brittlegg/visionquest/src/lib/progression/engine.ts)
- [`src/lib/intervention-scoring.ts`](/Users/brittlegg/visionquest/src/lib/intervention-scoring.ts)

### I need to change AI behavior

Start with:

- [`src/lib/gemini.ts`](/Users/brittlegg/visionquest/src/lib/gemini.ts)
- [`src/lib/sage/system-prompts.ts`](/Users/brittlegg/visionquest/src/lib/sage/system-prompts.ts)
- [`src/lib/sage/personality.ts`](/Users/brittlegg/visionquest/src/lib/sage/personality.ts)
- [`src/lib/sage/goal-extractor.ts`](/Users/brittlegg/visionquest/src/lib/sage/goal-extractor.ts)

### I need to change deployment or env expectations

Start with:

- [`DEPLOY.md`](/Users/brittlegg/visionquest/DEPLOY.md)
- [`render.yaml`](/Users/brittlegg/visionquest/render.yaml)
- [`/.env.example`](/Users/brittlegg/visionquest/.env.example)

## Local Development Checklist

```bash
npm install
cp .env.example .env.local
npm run prisma:generate
npm run prisma:migrate:deploy
npm run dev
```

Recommended verification after changes:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

For deeper UI confidence:

```bash
npm run test:smoke
npm run test:e2e
```

## Documentation Map

- [`README.md`](/Users/brittlegg/visionquest/README.md) onboarding and command reference
- [`DEPLOY.md`](/Users/brittlegg/visionquest/DEPLOY.md) deployment runbook
- [`docs/PRODUCT_GUIDE.md`](/Users/brittlegg/visionquest/docs/PRODUCT_GUIDE.md) product framing
- [`docs/PRODUCT_DECISIONS.md`](/Users/brittlegg/visionquest/docs/PRODUCT_DECISIONS.md) scope authority
- [`CLAUDE.md`](/Users/brittlegg/visionquest/CLAUDE.md) project operating instructions for agents
