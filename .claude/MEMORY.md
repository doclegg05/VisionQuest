# Project Memory

## Project Overview
- **Name**: Visionquest
- **Description**: AI-coach-driven program portal for SPOKES workforce development (adults on TANF/SNAP). AI coach named "Sage" guides students through goal-setting, orientation, certification tracking, portfolio building, and employability skills.
- **Tech stack**: Next.js 16 (App Router), TypeScript, Prisma 6, Supabase (PostgreSQL + Storage), Google Gemini 2.5 Flash, Tailwind CSS 4, Sentry
- **Hosting**: Render.com (free tier)
- **Repo**: https://github.com/doclegg05/VisionQuest.git
- **Live URL**: https://visionquest.onrender.com

## Current Status
Deployed and live. Sage AI coach working. Student registration/login working. Teacher registration at `/teacher-register`.

## Last Session
- **Date**: 2026-03-13
- **What we worked on**: Full deployment to Render — env vars, build fixes, Gemini model upgrade, streaming fix
- **What we decided**:
  - Removed `output: "standalone"` (not needed for Render, breaks static file serving)
  - Moved all devDependencies to dependencies (Render skips devDeps in production)
  - Upgraded Gemini from 2.0-flash to 2.5-flash (2.0 retired by Google)
  - systemInstruction must be at model level, not chat level
  - Separate teacher registration page with TEACHER_KEY validation
- **Where we left off**: App is live and working. Sage responds. Still need to test: file upload, orientation checklist, teacher registration flow, teacher dashboard.

## Open Items
- [x] Deploy to Render
- [x] Sage AI coach working in production
- [x] Student registration & login
- [ ] Test file upload (Supabase Storage)
- [ ] Test orientation checklist (should show 10 items)
- [ ] Test teacher registration at `/teacher-register`
- [ ] Test teacher dashboard at `/teacher`
- [ ] Set up Google OAuth (optional)
- [ ] Set up SMTP for password reset emails (optional)
- [ ] Remove TEACHER_KEY from student-facing .env if not needed locally

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
- **Env file**: `~/Desktop/render.env` (clean copy for Render import)
- **TEACHER_KEY**: Stored in Render env vars and `.env.local` only (not tracked in git)

## Known Issues
- Free tier Render instances sleep after inactivity (30-60s cold start)
- OAuth users get random password hash (can't use password login until teacher resets)
- No CSP headers configured yet (could add with nonces for Next.js compat)
- content/ directory has SPOKES reference materials but is not yet integrated into Sage AI (no RAG pipeline)
