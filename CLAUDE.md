# VisionQuest — Team Instructions

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach-driven program portal for SPOKES workforce development (adults on TANF/SNAP). AI coach named "Sage" guides students through goal-setting, orientation, certification tracking, portfolio building, and employability skills.
- **Tech stack**: Next.js 16 (App Router), TypeScript, Prisma 6, Supabase (PostgreSQL + Storage), Google Gemini 2.5 Flash, Tailwind CSS 4, Sentry
- **Hosting**: Render.com (free tier)
- **Repo**: https://github.com/doclegg05/VisionQuest.git
- **Live URL**: https://visionquest.onrender.com

## Architecture Notes
- Auth: JWT in httpOnly cookies (SameSite=strict), PBKDF2-SHA512 password hashing
- Chat: SSE streaming from `/api/chat/send`, two-call pattern (conversation + async goal extraction)
- Gemini: systemInstruction set at `getGenerativeModel()` level, MODEL_NAME constant in `src/lib/gemini.ts`
- File storage: local `./uploads/` in dev, Supabase Storage (S3-compatible) in prod
- CSRF: Origin header validation middleware for all POST/PUT/PATCH/DELETE to /api/*
- Student routes: `(student)` route group, Teacher routes: `(teacher)` route group

## Production Environment
- **Render Start Command**: `npm run prisma:migrate:deploy && node .next/standalone/server.js`
- **Render Build Command**: `npm ci && npx prisma generate && npm run build`
- **TEACHER_KEY**: Stored in Render env vars and `.env.local` only (not tracked in git)

## Key Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-11 | Next.js + Prisma + Gemini stack | Full framework, free AI tier, conversation-first UX |
| 2026-03-11 | Named AI coach "Sage" | Wise, calm, non-judgmental mentor personality |
| 2026-03-13 | Supabase Storage over Cloudflare R2 | Single service for DB + files, simpler architecture |
| 2026-03-13 | Sentry for error tracking | Client + server + edge, free tier sufficient |
| 2026-03-13 | Standalone output mode via render.yaml | Uses `node .next/standalone/server.js` for smaller container |
| 2026-03-13 | All deps in dependencies (no devDeps) | Render sets NODE_ENV=production before build, skips devDeps |
| 2026-03-13 | Gemini 2.5-flash with model-level systemInstruction | 2.0-flash retired; chat-level systemInstruction breaks streaming |
| 2026-03-13 | Separate /teacher-register page | Clear UX separation, requires TEACHER_KEY for authorization |
| 2026-04-01 | Job board expanded into an opportunity engine | Unified jobs, training programs, and apprenticeship support in one class-scoped pipeline instead of maintaining separate feature stacks |
| 2026-04-01 | CareerOneStop made the preferred baseline source | Official source reduces dependence on paid aggregators and now powers jobs plus training/apprenticeship support records |
| 2026-04-01 | Scraper usage guarded by app-side and provider-side limits | Added daily/monthly caps, manual refresh cooldowns, usage dashboard, and provider quota header tracking to stay below subscription limits |
| 2026-04-01 | Class search profiles drive opportunity retrieval | Instructors configure target roles, excluded employers, remote-only mode, wage floor, and opportunity types per class |

## Current Branch Memory
- Active integration branch: `integration/job-board`
- Latest integration commits:
  - `ceefbc7` `Add training and apprenticeship opportunities`
  - `b3abc74` `Add class search profiles for opportunity engine`
  - `1c539e9` `Unify job board sources and surface source health`
  - `59c1d98` `Add CareerOneStop job source`
  - `5a6a7cd` `Track provider quota headers for job scraping`
  - `8be1f27` `Add job board usage dashboard`
  - `0f34b70` `Add job scraper quota guardrails`
  - `06ae873` `Polish job board save and dashboard UX`
  - `15e4b3e` `Fix job board class scoping and refresh behavior`
- Current opportunity engine scope:
  - teacher-managed class config for region, sources, opportunity types, target roles, excluded employers, remote-only mode, wage floor, and auto refresh
  - unified student-facing opportunity board and dashboard widget for jobs, training programs, and apprenticeship support
  - class-scoped dedupe, save/apply tracking, and recommendation scoring
  - official/public-first source strategy with CareerOneStop baseline and aggregators as fallback coverage
- Current rollout requirements:
  - run the new Prisma migrations before deploying
  - validate live CareerOneStop credentials in the target environment
  - do a manual browser pass on teacher config, student `/jobs`, and dashboard widget before merging/pushing to production

## Known Issues
- Free tier Render instances sleep after inactivity (30-60s cold start)
- OAuth users get random password hash (can't use password login until teacher resets)
- No CSP headers configured yet (could add with nonces for Next.js compat)
- docs-upload/sage-context/ is intended for RAG grounding documents but is not yet populated or integrated into Sage AI
