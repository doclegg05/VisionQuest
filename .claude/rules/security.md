# Security Rules

## Authentication
- JWT stored in httpOnly cookie with SameSite=strict — never in localStorage or URL params
- Passwords hashed with scrypt (N=2^15, r=8, p=1, 64-byte key) in `src/lib/auth.ts` — legacy PBKDF2-SHA512 records are verified and transparently rehashed on login; never bcrypt, never plaintext
- Session invalidation: `sessionVersion` column on Student — increment to force re-auth
- Teacher registration requires `TEACHER_KEY` validation — never auto-promote
- MFA: TOTP with encrypted secrets and replay-protected counters (`src/lib/mfa.ts`)

## Authorization
- Every API route must validate JWT via `src/lib/auth.ts` before processing
- Teacher-only routes must check `role === 'teacher'` from JWT claims
- Student data queries must include `studentId` ownership check — never return cross-student data
- Admin routes must check admin flag — separate from teacher role
- Defense in depth via Postgres RLS: `src/proxy.ts` strips any client-supplied `x-vq-*` headers before `src/lib/rls-headers.ts` derives them from the verified JWT; app queries run as the `vq_app` role. Never bypass `withRlsContext`, and never weaken the coordinator fail-closed clause in `src/lib/classroom.ts` without region-scoping (see its invariant comment)
- Staff reads of student data are audited via `recordStudentView` in `src/lib/audit.ts` (sampled 1/teacher/student/surface/day) — wire it into any new teacher-facing student-data GET

## CSRF
- Origin header validation on all POST/PUT/PATCH/DELETE to `/api/*`
- Implemented in middleware — do not bypass for "internal" routes
- CRON_SECRET bearer token authenticates internal cron endpoints instead

## Input Validation
- Use Zod schemas for all request body parsing — never trust raw `req.json()`
- File uploads: validate MIME type against allowlist, enforce size limits
- URL parameters: validate with `z.string().cuid()` for IDs

## Secrets Management
- All secrets in `.env.local` (local) or Render env vars (prod) — never committed to git
- `NEXT_PUBLIC_*` prefix only for values safe to expose to client bundles
- API keys (Gemini, Sentry DSN) must stay server-side — never in client components
- Student `geminiApiKey` is encrypted at rest via `API_KEY_ENCRYPTION_KEY`

## Data Privacy
- Students are TANF/SNAP recipients — PII handling is critical
- No PII in server logs — Sentry configured to scrub sensitive fields
- Audit log captures who did what, but not the full data payload
- File uploads go to Supabase Storage (not local FS) in production
