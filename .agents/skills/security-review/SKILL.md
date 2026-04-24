# Security Review Skill

Automatically invoked when reviewing auth, API, or data-handling changes.

## Checklist
1. No hardcoded secrets — all sensitive values in `.env.local` or Render env vars
2. JWT tokens use httpOnly + SameSite=strict cookies
3. Password hashing uses PBKDF2-SHA512 (not bcrypt, not plaintext)
4. CSRF Origin validation present on all mutating API routes
5. Prisma queries use parameterized inputs — no raw SQL string interpolation
6. File uploads validated: type, size, and stored via Supabase Storage (not local FS in prod)
7. Teacher endpoints validate TEACHER role from JWT claims
8. Student data never exposed to other students — ownership checks on all queries
9. API keys (Gemini, Sentry DSN) never sent to client bundles
10. Rate limiting on `/api/chat/send` to prevent AI abuse
