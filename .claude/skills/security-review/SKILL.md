# Security Review Skill

Automatically invoked when reviewing auth, API, or data-handling changes.

## Checklist
1. No hardcoded secrets — all sensitive values in `.env.local` or Render env vars
2. JWT tokens use httpOnly + SameSite=strict cookies (Secure in production) — see `setSessionCookie` in `src/lib/auth.ts`
3. Password hashing uses scrypt (N=2^15, r=8, p=1, 64-byte key) via `hashPassword` in `src/lib/auth.ts`; legacy PBKDF2-SHA512 records are verified and transparently rehashed to scrypt on login (`verifyPasswordWithStatus` → `needsRehash`); all hash comparisons use `crypto.timingSafeEqual`
4. CSRF Origin validation present on all mutating API routes
5. Prisma queries use parameterized inputs — no raw SQL string interpolation
6. File uploads validated: type, size, and stored via Supabase Storage (not local FS in prod)
7. Staff endpoints validate role (teacher or admin — `isStaffRole` in `src/lib/api-error.ts`) from the server-validated session; `getSession` in `src/lib/auth.ts` re-checks `sessionVersion` and `isActive` against the database
8. Student data never exposed to other students — ownership checks on all queries
9. API keys (Gemini, Sentry DSN) never sent to client bundles
10. Rate limiting (DB-backed `rateLimit` in `src/lib/rate-limit.ts`) on auth routes (login, MFA, password reset/forgot, teacher register) and AI/upload endpoints (`/api/chat/send`, chat upload/warmup/slash-commands, resume assist, Sage tools) — keep it on any new AI or auth route
