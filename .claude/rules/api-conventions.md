# API Conventions

- All API routes live under `src/app/api/`
- CSRF protection: Origin header validation on all mutating requests (POST/PUT/PATCH/DELETE)
- Auth: JWT from httpOnly cookie, validated via `src/lib/auth.ts` helpers
- Response format: `{ success: true, data: ... }` or `{ error: "message" }` with appropriate HTTP status
- SSE streaming for chat responses at `/api/chat/send`
- Rate limiting: apply per-user rate limits on AI endpoints
- Never return raw Prisma errors to the client — wrap in generic error messages
