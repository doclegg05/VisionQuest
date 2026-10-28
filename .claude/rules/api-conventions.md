---
paths:
  - "src/app/api/**"
---
# API Conventions

- All API routes live under `src/app/api/`
- CSRF protection: Origin header validation on all mutating requests (POST/PUT/PATCH/DELETE)
- Auth: JWT from httpOnly cookie, validated via `src/lib/auth.ts` helpers
- Validation standard: every NEW or MODIFIED route parses request bodies with a Zod schema via `parseBody` (`src/lib/schemas.ts`) — no raw `req.json()` with hand-rolled type guards. Legacy hand-rolled routes are converted opportunistically when touched, not in a big-bang migration
- New route families use `{ success: true, data: ... }` or `{ error: "message" }` with appropriate HTTP status. The task and dashboard families (`/api/tasks/**`, `/api/teacher/students/:id/tasks`, `/api/dashboard/**`) retain their existing plain-object success responses and `{ error: "message" }` failures. Preserve these caller contracts when extending those families; a coordinated response-envelope migration is separate work (owner decision, 2026-10-26).
- SSE streaming for chat responses at `/api/chat/send`
- Rate limiting: apply per-user rate limits on AI endpoints
- Never return raw Prisma errors to the client — wrap in generic error messages
