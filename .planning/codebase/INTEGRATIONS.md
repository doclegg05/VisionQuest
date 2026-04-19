# External Integrations

**Analysis Date:** 2026-04-18

Status legend:
- **Active (prod)** — live-configured on Render, exercised by user traffic
- **Active (optional)** — wired in, silently degrades to no-op when env vars are missing
- **Dev-only** — used only in local dev or as a fallback
- **Dormant** — code path exists but is not exercised today

## AI Providers

| Service | Status | Where |
|---------|--------|-------|
| Google Gemini (`@google/generative-ai`) | **Active (prod)** — default provider | `/src/lib/ai/gemini-provider.ts`. Model resolved from `GEMINI_MODEL` env var, default `gemini-2.5-flash-lite`. `systemInstruction` is set at `getGenerativeModel()` level (chat-level breaks streaming — see `CLAUDE.md` decision log) |
| Ollama / OpenAI-compatible local LLM | **Dormant** — provider code complete, not selected in prod | `/src/lib/ai/ollama-provider.ts` + `/src/lib/ai/health.ts`. Dual-mode: probes `/v1/chat/completions` first, falls back to native `/api/chat`. Selected when SystemConfig `ai_provider = "local"`; currently `"cloud"`. Mac Studio + Gemma 4 rollout planned for ~June 2026. Supports `none` / `bearer` / `cloudflare_service_token` auth modes |

**Provider resolution:** `/src/lib/ai/provider.ts#getProvider(studentId)` reads SystemConfig per request. Returned instance satisfies `AIProvider` interface in `/src/lib/ai/types.ts` (`generateResponse`, `streamResponse`, `generateStructuredResponse`).

**API key resolution order** (`/src/lib/chat/api-key.ts`):
1. Per-student encrypted `Student.geminiApiKey` (AES-256-GCM)
2. Admin-managed platform key in `SystemConfig.gemini_api_key`
3. `GEMINI_API_KEY` env var
4. Throws with "Sage is not configured yet" message

**Guardrails** (`/src/app/api/chat/send/route.ts`): hourly (40/60/120 by role) + daily (200/400 by role, admins unlimited) rate limits + token quota (`checkTokenQuota` in `/src/lib/llm-usage.ts`) apply *only* when `provider.name === "gemini"`. Local Ollama has no cost, so limits are skipped.

## Data Storage

| Service | Status | Config | Client |
|---------|--------|--------|--------|
| Supabase PostgreSQL | **Active (prod)** | `DATABASE_URL` (pooled), `DIRECT_URL` (migrations). Pool params appended dynamically from `DB_POOL_SIZE` (default 5) and `DB_POOL_TIMEOUT` (default 10s) in `/src/lib/db.ts` | Prisma 6, schema `visionquest` |
| Supabase Storage (S3-compatible) | **Active (prod)** | `STORAGE_ENDPOINT`, `STORAGE_REGION=us-east-1`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`. `forcePathStyle: true` | `@aws-sdk/client-s3` in `/src/lib/storage.ts` |
| Cloudflare R2 | **Active (prod + dev)** | `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`. Used in Render prod, local dev, and other envs that predate the Supabase Storage migration. Selected when `R2_*` vars are set and `STORAGE_*` vars are not. | Same `/src/lib/storage.ts` (endpoint swap) |
| Local filesystem (`./uploads/`) | **Dev-only** | Active when `NODE_ENV !== "production"` and no storage vars set | Node `fs/promises` |
| `./docs-upload/` | **Dormant** | Intended bundled grounding docs for RAG — directory does not exist in repo. `/src/lib/storage.ts#downloadBundledFile` falls back to a fuzzy filename search of `/content/` | — |

**RLS status:** Enabled on all 61 tables (migrations `20260403060000` + `20260415000000`). Prisma connects as `postgres` (superuser) which bypasses RLS. Tenant isolation is enforced by application-layer `where: { studentId: ... }` checks, not DB policies. Supabase PostgREST API via anon/authenticated roles is blocked by default-deny. Planned defense-in-depth: restricted `vq_app` role + per-request GUCs — see `/docs/plans/supabase-optimization.md`.

## RAG / Knowledge Layer

| Component | Status | Where |
|-----------|--------|-------|
| Static program knowledge (SPOKES, Adult Ed, IETP) | **Active (prod)** | `/src/lib/sage/knowledge-base.ts` — inlined into Sage system prompt. Heavy block gates on `KNOWLEDGE_HEAVY_STAGES` (orientation, general, teacher_assistant, admin_assistant); other stages get the 60-token `SPOKES_BRIEF` |
| Keyword-triggered topic expansion | **Active (prod)** | `getRelevantContent(userMessage)` in same file. Matches `TOPIC_KEYWORDS` → `TOPIC_CONTENT`, top 3 by score. Fires on every message |
| `ProgramDocument` + `SageSnippet` document RAG | **Dormant** | `getDocumentContext()` in `/src/lib/sage/knowledge-base.ts` queries `prisma.programDocument` (filter `usedBySage = true`) and `prisma.sageSnippet`. Scores by keyword/title/certification/platform match, enforces 6,000-char budget. Cached 300s. **No documents ingested**: `docs-upload/sage-context/` does not exist on disk. Function returns `""` until seeding runs (`npm run db:seed-documents`, `npm run seed:sage-context`) |
| Vector similarity | **Not implemented** | Comment in `knowledge-base.ts` (line 561) flags pgvector cosine similarity as the upgrade path if corpus exceeds ~200 docs. Same function signature would be preserved |

## Authentication & Identity

| Provider | Status | Where |
|----------|--------|-------|
| Password (scrypt, legacy PBKDF2) | **Active (prod)** | `/src/lib/auth.ts`. Scrypt N=2^15, r=8, p=1, maxmem=64 MiB. Legacy PBKDF2 hashes are re-hashed on successful login |
| Google OAuth | **Active (optional)** | `/src/app/api/auth/google/route.ts` + `/callback/route.ts`. OAuth-only users have `passwordHash = null` (fixed 2026-04-01). Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| TOTP MFA | **Active (optional)** | `/src/lib/mfa.ts`. Opt-in per user. AES-256-GCM-encrypted `mfaSecret`, SHA-256-hashed backup codes, replay prevention via `mfaLastUsedCounter` |
| Security questions (password reset) | **Active (prod)** | `/src/lib/security-questions.ts`, `/src/lib/password-reset.ts` |
| Session token | JWT HS256, httpOnly `vq-session` cookie, 7-day TTL, `sameSite: strict`, `secure` in prod. Session invalidation via `Student.sessionVersion` bump | `/src/lib/auth.ts` |
| MFA challenge token | JWT HS256, 5-minute TTL, `purpose: "mfa_challenge"` | `/src/lib/auth.ts#signMfaSessionToken` |

## Observability

| Service | Status | Config |
|---------|--------|--------|
| Sentry (`@sentry/nextjs`) | **Active (optional)** | Client / server / edge configs: `/sentry.client.config.ts`, `/sentry.server.config.ts`, `/sentry.edge.config.ts`. Initialized only when `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` present. PII scrubber at `/src/lib/sentry-scrub.ts`. In-app Sentry usage is minimal — `/src/app/error.tsx` + the scrubber are the only direct importers. Source map upload gated on `SENTRY_AUTH_TOKEN` |
| Structured logging | **Active (prod)** | `/src/lib/logger.ts`. JSON output in prod, pretty-print in dev. Levels from `LOG_LEVEL` env var (default `info`). Used throughout API routes |
| Audit log | **Active (prod)** | `/src/lib/audit.ts` writes to `AuditEvent` table. Registry middleware (`/src/lib/registry/middleware.ts`) auto-logs access for tools with `auditLevel: "basic" \| "full"` |
| CSP violation reports | **Active (prod)** | `/src/app/api/csp-report/` — endpoint declared in CSP `report-uri` (`/src/proxy.ts`) |

## Credly (external verification)

| | |
|---|---|
| Status | **Active (optional)** |
| Purpose | Student imports earned badges onto their profile |
| API | Unauthenticated Credly public badges endpoint (no API key) |
| Where | `/src/app/api/credly/badges/route.ts`, `/src/app/api/settings/credly/route.ts`, `/src/components/certifications/CredlyConnect.tsx`, `/src/components/certifications/CredlyBadges.tsx` |
| CSP allowlist | `images.credly.com`, `www.credly.com` (img-src) in `/src/proxy.ts` |
| Cache | Per-student badges cached 10 min via `/src/lib/cache.ts` |

## Communication Channels

| Channel | Status | Where | Env |
|---------|--------|-------|-----|
| SMTP email (nodemailer) | **Active (optional)** | `/src/lib/email.ts`, templates at `/src/lib/email-templates.ts`. Dynamic import of `nodemailer` so it's tree-shaken when unused | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Password reset is disabled when not configured |
| Twilio SMS | **Active (optional)** | `/src/lib/sms.ts` — direct REST call, no SDK. Silently no-ops when unconfigured | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |

## CI / Deploy

| | |
|---|---|
| Host | Render.com free tier |
| Service manifest | `/render.yaml` |
| Web service | `buildCommand: npm ci && npx prisma generate && npm run build` / `startCommand: npm run prisma:migrate:deploy; node .next/standalone/server.js` / `healthCheckPath: /api/health` |
| Cron jobs | Three declared in `/render.yaml`: `visionquest-appointment-reminders` (hourly), `visionquest-job-processor` (every 10 min), `visionquest-daily-coaching` (daily 13:00 UTC). Entry points at `/scripts/run-*.mjs`. **Free-tier cron execution is unverified** — flagged in `CLAUDE.md` known issues |
| Cron auth | Shared `CRON_SECRET` passed as `Authorization: Bearer <secret>`. Validated by `isAuthorizedInternalRequest()` in `/src/lib/csrf.ts` for paths under `/api/internal/` |
| Docker | `/Dockerfile` provided (node:20-alpine multi-stage) but Render uses native Node runtime, not Docker |

## Webhooks

### Outgoing
`/src/lib/webhooks.ts#dispatchWebhookEvent`. HMAC-SHA256 signed payloads to subscribers recorded in `WebhookSubscription` table. Event types: `student.enrolled`, `goal.confirmed`, `goal.stalled`, `certification.completed`, `form.signed`, `kpi.snapshot`. Headers: `X-VisionQuest-Signature`, `X-VisionQuest-Event`. 10-second timeout, fire-and-forget.

### Incoming
None currently. Google OAuth callback is the only external POST endpoint.

## Content Security Policy — External Origins

Set per-request in `/src/proxy.ts`:

| Directive | Allowed origins |
|-----------|-----------------|
| `connect-src` | `generativelanguage.googleapis.com`, `*.ingest.sentry.io` |
| `img-src` | `images.credly.com`, `www.credly.com`, `data:`, `blob:` |
| `style-src` | `fonts.googleapis.com` |
| `font-src` | `fonts.gstatic.com` |
| `script-src` | `'self' 'nonce-<random>' 'strict-dynamic'` (+ `'unsafe-eval'` in dev) |

## Environment Variables

Required (validated at boot in `/src/lib/env.ts#validateRuntimeEnv`, called from `/src/instrumentation.ts`):

| Var | Notes |
|-----|-------|
| `DATABASE_URL` | Postgres URL, validated protocol, quote-paranoid |
| `JWT_SECRET` | ≥ 32 chars |
| `API_KEY_ENCRYPTION_KEY` | Base64-encoded, must decode to exactly 32 bytes |
| `APP_BASE_URL` | http/https URL |

Optional (validated when present):
- `DIRECT_URL`, `GEMINI_API_KEY`, `TEACHER_KEY`, `ADMIN_KEY`, `CRON_SECRET`
- Storage: `STORAGE_*` or legacy `R2_*`
- OAuth: `GOOGLE_*`
- SMTP: `SMTP_*`
- Twilio: `TWILIO_*`
- Sentry: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`
- LLM tuning: `GEMINI_MODEL`, `LOG_LEVEL`, `DB_POOL_SIZE`, `DB_POOL_TIMEOUT`, `VISIONQUEST_DISABLE_RATE_LIMITS`

---

*Integration audit: 2026-04-18*
