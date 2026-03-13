# Project Memory

## Project Overview
- **Name**: Visionquest
- **Description**: AI-coach-driven program portal for SPOKES workforce development (adults on TANF/SNAP). AI coach named "Sage" guides students through goal-setting, orientation, certification tracking, portfolio building, and employability skills.
- **Tech stack**: Next.js 15 (App Router), TypeScript, Prisma 6, Supabase (PostgreSQL), Google Gemini API, Tailwind CSS
- **Hosting**: Render.com
- **Repo**: https://github.com/doclegg05/VisionQuest.git

## Current Status
Sprint 1 (Infrastructure) complete. Code on GitHub. CI pipeline active. Ready for Sprint 2 (Harden).

## Last Session
- **Date**: 2026-03-13
- **What we worked on**: Sprint 1 — deployment foundation
- **What we decided**: 3-sprint plan to production (Infra → Harden → Polish+Monitor). Render for hosting, Supabase for DB, GitHub Actions for CI.
- **Where we left off**: Sprint 1 complete and pushed. Sprint 2 next: structured logging, input validation hardening, CSRF, API integration tests, E2E smoke tests, audit logging expansion.

## Open Items
- [x] Phase 1: Foundation (auth, chat, scaffold)
- [x] Phase 2: Goal setting + progression engine
- [x] Phase 3: Orientation + LMS Hub
- [x] Phase 4: Certifications + File upload (R2)
- [x] Phase 5: Portfolio + Resume builder
- [x] Phase 6: Employability Skills (linked as cert requirements, not standalone)
- [x] Phase 7: Teacher Dashboard (class overview, student detail, cert verify, CSV export)
- [x] Phase 8: Polish (mobile nav, Google OAuth, a11y, teacher password reset)
- [x] Set up GitHub repo and push
- [ ] Set up Supabase project and add connection strings to .env.local
- [ ] Get Gemini API key from Google AI Studio
- [ ] Deploy to Render (render.yaml ready)
- [x] Sprint 1: Health check, env validation, error pages, CSP, Dockerfile, CI, render.yaml
- [ ] Sprint 2: Structured logging, input validation, CSRF, API tests, E2E tests, audit expansion
- [ ] Sprint 3: Error tracking (Sentry), monitoring, deployment docs, load testing, UAT, SPOKES data seeding

## Key Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-11 | New project, not modify SPOKES app | Clean architecture, conversation-first design requires fundamentally different UX |
| 2026-03-11 | Next.js 15 + TypeScript | Full framework for rich chat UI, SSR, API routes |
| 2026-03-11 | Prisma 6 over Prisma 7 | Prisma 7 has breaking config changes, less documented |
| 2026-03-11 | Gemini free tier | Zero cost, generous limits, good quality for coaching |
| 2026-03-11 | Conversation-first (not form-first) | Sage leads the experience; goals extracted from dialogue |
| 2026-03-11 | Named coach "Sage" | Wise, calm, non-judgmental mentor personality |
| 2026-03-11 | Teachers see AI summaries, not transcripts | Protects student trust and privacy |
| 2026-03-11 | Employability Skills as cert requirement links | Lessons on GitHub Pages, incomplete (~1yr), avoids duplicate tracking |
| 2026-03-11 | Nav: replaced Skills with Files | Skills integrated into Certifications, Files page more useful |
| 2026-03-11 | Google OAuth via standard OAuth 2.0 flow | No extra deps, school Google accounts |
| 2026-03-11 | Dashboard module card: Files replaces Skills | Consistent with nav change |
| 2026-03-13 | 3-sprint deployment plan | Sprint 1: infra, Sprint 2: harden, Sprint 3: polish+monitor |
| 2026-03-13 | Standalone Next.js output for Docker | Smaller container, faster cold starts on Render |
| 2026-03-13 | CSP with unsafe-inline/eval for Next.js compat | Next.js requires inline scripts; tighten with nonces in Sprint 3 |

## Architecture Notes
- Auth: JWT in httpOnly cookies, PBKDF2 password hashing
- Chat: SSE streaming from `/api/chat/send`, two-call pattern (conversation + async goal extraction)
- Goal extraction: Gemini structured JSON output, confidence > 0.7 threshold
- System prompts: layered (personality + guardrails + platform knowledge + stage-specific)
- Stage determination: based on which goal levels exist in DB
- Student routes under `(student)` route group with server-side auth check in layout
- Teacher routes under `(teacher)` route group with teacher role check
- File storage: local `./uploads/` in dev, Cloudflare R2 in prod
- Cert system: CertTemplate (teacher defines), CertRequirement (student progress), auto-creates on first visit
- Google OAuth: standard flow (no library), auto-creates student account from Google profile
- Teacher dashboard: /teacher (class overview), /teacher/students/[id] (detail + cert verify + password reset)
- A11y: skip-to-content link, ARIA labels/roles/live regions, focus-visible styles, prefers-reduced-motion

## Known Issues
- No Gemini API key configured yet — chat will fail until key is added to .env.local
- No rate limiting on chat endpoint
- No input sanitization on chat messages beyond trim
- R2 auth uses Basic auth (works but should use AWS Signature V4 for production)
- Google OAuth requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI env vars
- OAuth users get random password hash (can't use password login until teacher resets)

## Environment Variables Needed
| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google AI Studio API key (free) |
| `JWT_SECRET` | Token signing secret |
| `TEACHER_KEY` | Teacher registration code |
| `DATABASE_URL` | Supabase pooled connection string (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase direct connection string (port 5432, for migrations) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY` | R2 access key |
| `R2_SECRET_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `NODE_ENV` | `production` |
