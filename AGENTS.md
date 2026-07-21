# VisionQuest — Team Instructions

## Agent Onboarding Rule
The primary agent MUST read this AGENTS.md first, then follow the Documentation Context Map below to read only the docs relevant to the current task. Subagents should NOT read the entire project — the primary agent determines which specific files and context each subagent needs.

## Documentation Context Map

Agents should read docs based on what they are doing. Do not read everything — follow the routing below.

### Level 0: Always Read First
- **This file (AGENTS.md)** — project overview, architecture, operating rules, key decisions

### Level 1: Product-Shaping Work
Read before any change that affects what users see or how workflows behave.
- **[docs/PRODUCT_GUIDE.md](./docs/PRODUCT_GUIDE.md)** — mission, users, charter, JTBD, 90-day outcomes, current gaps, decision lens

### Level 2: Scope or Framework Questions
Read when deciding what to build, cut, simplify, or automate.
- **[docs/PRODUCT_DECISIONS.md](./docs/PRODUCT_DECISIONS.md)** — authoritative scope decisions, 5-step framework applied to VisionQuest, immediate action plan

### Level 3: Domain-Specific (read only when working in that area)
| Area | Document |
|------|----------|
| Goal/learning/evidence architecture | [docs/ACADEMIC_EFFECTIVENESS_ROADMAP.md](./docs/ACADEMIC_EFFECTIVENESS_ROADMAP.md) |
| Infrastructure & Supabase optimization | [docs/plans/supabase-optimization.md](./docs/plans/supabase-optimization.md) |
| Funding & vendor billing structure | [docs/plans/funding-options-monthly-subscriptions.md](./docs/plans/funding-options-monthly-subscriptions.md) |
| Local AI hosting & tunnel recommendation | [docs/plans/2026-04-15-local-ai-tunnel-recommendation.md](./docs/plans/2026-04-15-local-ai-tunnel-recommendation.md) |
| Frontend redesign implementation | [docs/superpowers/plans/2026-03-30-frontend-redesign.md](./docs/superpowers/plans/2026-03-30-frontend-redesign.md) |
| Job board implementation | [docs/superpowers/plans/2026-03-31-job-board.md](./docs/superpowers/plans/2026-03-31-job-board.md) |
| Deployment & hosting | [DEPLOY.md](./DEPLOY.md) |
| Developer setup & scripts | [README.md](./README.md) |
| SPOKES content reference | [content/_INDEX.md](./content/_INDEX.md) |

### Archived (do not read unless explicitly asked)
- `docs/archive/GAMIFICATION_BACKLOG.md` — frozen planning artifact
- `docs/archive/SETUP_WIZARD_PLAN.md` — frozen planning artifact

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach-driven program portal for SPOKES workforce development (adults on TANF/SNAP). AI coach named "Sage" guides students through goal-setting, orientation, certification tracking, portfolio building, and employability skills.
- **Tech stack**: Next.js 16 (App Router), TypeScript, Prisma 6, Supabase (PostgreSQL + Storage), Google Gemini 3.1 Flash Lite (+ optional local Ollama provider), Tailwind CSS 4, Sentry
- **Hosting**: Render.com (Starter plan — no instance sleep)
- **Repo**: https://github.com/doclegg05/VisionQuest.git
- **Live URL**: https://visionquest.onrender.com

## Architecture Notes
- Auth: JWT in httpOnly cookies (SameSite=strict), scrypt password hashing (legacy PBKDF2 rehashed on login), TOTP MFA, `sessionVersion` invalidation
- AI providers: `src/lib/ai/` abstraction — Gemini cloud + Ollama local, routed by data sensitivity (FERPA-sensitive classes are local-only by policy); systemInstruction set at `getGenerativeModel()` level (`DEFAULT_GEMINI_MODEL` in `src/lib/gemini.ts`)
- Chat: SSE streaming from `/api/chat/send`, two-call pattern (conversation + prioritized async extraction); deterministic crisis safety net (988, English + Spanish patterns)
- RAG: live hybrid pgvector + full-text retrieval (`src/lib/sage/hybrid-retrieval.ts`) over `ProgramDocument` rows + the `catalog/` OKF layer; gating red-team evals in CI
- File storage: local `./uploads/` in dev, Supabase Storage (S3-compatible) in prod
- CSRF: Origin header validation middleware for all POST/PUT/PATCH/DELETE to /api/*; Postgres RLS with spoofable-header stripping
- Student routes: `(student)` route group, Teacher routes: `(teacher)` route group
- CLAUDE.md (same repo) carries the fuller, more current architecture notes — when the two disagree, trust CLAUDE.md

## Production Environment
- **Render Start Command**: `npm run prisma:migrate:deploy && node .next/standalone/server.js`
- **Render Build Command**: `npm ci && npx prisma generate && npm run build`
- **TEACHER_KEY**: Stored in Render env vars and `.env.local` only (not tracked in git)

## Product Scope Authority
- **Authoritative doc**: `docs/PRODUCT_DECISIONS.md` — governs all product scope decisions (5-step framework: Question → Delete → Simplify → Accelerate → Automate)
- **Key decision (April 1, 2026, superseded June 10, 2026)**: Vision Board, Files, and Resources features are retained; the chat-first redesign moved Resources out of nav (reachable via Learning) and renamed Files to "Documents". See the 2026-06-10 and 2026-07-20 entries in `docs/PRODUCT_DECISIONS.md`.

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
| 2026-04-01 | Product docs consolidated into PRODUCT_GUIDE + PRODUCT_DECISIONS | Resolves conflicts — Vision Board, Files, Resources retained |
| 2026-04-01 | StudentDetail split into 4-tab layout | 2043→472 line parent; tabs: Overview, Goals & Plan, Progress, Operations |
| 2026-04-01 | Intervention queue as primary teacher dashboard | Urgency-scored student list above ClassOverview |
| 2026-04-01 | Goal confirmation model added | `confirmed` status, `confirmedAt`, `confirmedBy`, `lastReviewedAt` fields on Goal |
| 2026-04-01 | Unified readiness computation | Single `fetchStudentReadinessData()` used by all 6 consumers |
| 2026-04-01 | CSP headers with nonce-based scripts/styles | Hardened via `src/proxy.ts`; Gemini, Credly, Sentry, Google Fonts whitelisted |

## Known Issues
- ~~Free tier Render instances sleep after inactivity~~ — Resolved: project is on Render Starter plan (verified 2026-04-29 in `render.yaml`)
- ~~OAuth users get random password hash~~ — Fixed (2026-04-01): passwordHash is now null for OAuth users
- ~~No CSP headers configured~~ — Fixed (2026-04-01): nonce-based CSP in `src/proxy.ts`
- ~~docs-upload/sage-context/ intended for RAG grounding~~ — Stale: that directory is empty and unmapped. Grounding documents live as `ProgramDocument` rows curated via the teacher sage-context API plus the `catalog/` OKF layer; RAG is live
- ~~Render free tier may not execute cron jobs~~ — Resolved: cron jobs run in Supabase pg_cron (see `docs/plans/pg-cron-setup-runbook.md`)

## Design Context
- **Full design context**: See [.impeccable.md](./.impeccable.md) for complete design principles, color system, typography, and accessibility requirements
- **Brand personality**: Bold, Supportive, Practical — direct, action-oriented ally
- **Emotional goals**: Confidence, Momentum, Safety, Pride
- **Reference**: Khan Academy — warm, educational, progress-focused, not childish
- **Accessibility**: WCAG AA + low literacy focus (plain language, visual cues, large touch targets, 6th-grade reading level)
- **Design principles**: (1) Clarity over cleverness (2) Progress is visible (3) Warm but not childish (4) Action-first surfaces (5) Inclusive by default
