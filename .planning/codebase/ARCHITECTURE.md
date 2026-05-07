# Architecture

**Analysis Date:** 2026-04-18

## Overall Pattern

Server-rendered Next.js 16 App Router app with three role-segmented route groups, a capability-registry-enforced API surface, and a streaming LLM chat pipeline. Data access is strictly server-side through a single Prisma client. No Redux / React Query / GraphQL — server components load data, API route handlers mutate.

**Key characteristics:**
- Route groups (`(student)`, `(teacher)`, `(admin)`) map 1:1 to role-gated layouts
- Every mutating API route is wrapped by `withRegistry(toolId, handler)` — single enforcement point for auth, RBAC, rate limits, audit logging
- In-memory adapter caching for DB reads (`/src/lib/cache.ts`) with prefix-based invalidation on writes
- Chat is SSE streaming with stage-gated system prompts and fire-and-forget post-processing
- Proxy (Next 16 "middleware") handles CSRF + per-request CSP nonce + API versioning

## Request Lifecycle

### All requests
1. **`/src/proxy.ts#proxy`** (Next 16 proxy — filename must be `proxy.ts`, export named `proxy`):
   - For state-changing `/api/*` requests: CSRF check via `Origin` / `Referer` host match (`isUrlHostMatch` in `/src/lib/csrf.ts`). `/api/internal/*` routes bypass via `Authorization: Bearer ${CRON_SECRET}`. `/api/health` exempted.
   - Generates 16-byte base64 CSP nonce, injects as `x-csp-nonce` request header and `Content-Security-Policy` response header.
   - Adds `X-API-Version: 1` to `/api/*` responses.
2. Static headers (HSTS, X-Frame-Options DENY, Permissions-Policy, Referrer-Policy) applied by `/next.config.ts#headers()`.

### Authenticated API request (90% of routes)
1. `withRegistry(toolId, handler)` from `/src/lib/registry/middleware.ts`:
   - Looks up tool in `/src/lib/registry/tools.ts` (`getTool(toolId)`). Unknown → 500 `UNKNOWN_TOOL`. Disabled → 503 `TOOL_DISABLED`.
   - `getSession()` from `/src/lib/auth.ts`: reads JWT from `vq-session` cookie, verifies HS256, loads `Student` by id. Session cache: 10s via `cached("session:<id>:<sv>", ...)` keyed by user id + session version.
   - `resolvePermission(role, toolId)` from `/src/lib/rbac.ts`: queries `RolePermission` table (1-min cache). If RBAC is unseeded (`rolePermission.count() === 0`), falls back to static `requiredRoles` array on the tool definition.
   - Audit log written via `logAuditEvent` when `tool.auditLevel ∈ {"basic","full"}` — fire-and-forget.
2. Handler runs. Body parsing uses `parseBody(req, zodSchema)` from `/src/lib/schemas.ts`.
3. Errors: `ApiError` → structured JSON; unknown errors → 500, with message leaked to admins only.

### Chat SSE request (`POST /api/chat/send`)
Single most complex flow — `/src/app/api/chat/send/route.ts`:

1. `withRegistry("sage.chat", ...)` authenticates + authorizes.
2. `parseBody(req, chatSendSchema)` validates `{ message, conversationId?, requestedStage? }`.
3. `getProvider(session.id)` from `/src/lib/ai/provider.ts` resolves the active AI provider (Gemini or Ollama) based on SystemConfig `ai_provider`.
4. **Guardrails (cloud only)** — skipped when `provider.name !== "gemini"`:
   - `rateLimit` hourly: 40/60/120 msgs by role
   - `rateLimitDaily`: 200/400 by role; admins exempt
   - `checkTokenQuota` — token-cost-based daily budget
5. Conversation resolved: `getOrCreateConversation` (student) or `getOrCreateTeacherConversation` (teacher/admin) from `/src/lib/chat/conversation.ts`.
6. User message saved to `Message` table.
7. Context assembled:
   - Students: `getStudentPromptContext(studentId, conversationId, stage)` from `/src/lib/chat/context.ts` — goals, orientation status, form submissions, career discovery, last 3 prior conversation summaries, skill-gap analysis (cached 600s), learning pathway (cached 600s), coaching arc. Cached 300s at `chat:base-context:<studentId>:<conversationId>:<stage>`.
   - Staff: no context assembly — just `buildSystemPrompt("teacher_assistant" | "admin_assistant", ...)`.
8. `buildSystemPrompt(stage, ...)` from `/src/lib/sage/system-prompts.ts` — stage-gated, program-aware. Heavy knowledge base (~5k tokens) only injected for `KNOWLEDGE_HEAVY_STAGES = {orientation, general, teacher_assistant, admin_assistant}`; other stages get `SPOKES_BRIEF` (~60 tokens).
9. `getDocumentContext(userMessage, callerRole)` from `/src/lib/sage/knowledge-base.ts` — keyword-scored RAG over `ProgramDocument` + `SageSnippet` (dormant: no docs ingested). Always appended if anything scores.
10. Soft-cap warning text injected into prompt when ≥ 80% of daily limit used.
11. `console.info("sage.prompt.size", systemPrompt.length)` — live baseline log, retained post-`feat/sage-speed` merge.
12. **Stream:** `provider.streamResponse(systemPrompt, messages)` yields text chunks. Each chunk is wrapped as `data: {"text": "..."}\n\n` SSE event. Initial event carries `{conversationId}`; terminal event carries `{done: true}`. Response headers: `text/event-stream`, `X-Accel-Buffering: no`. **Non-streaming path (`useNonStreaming = false`) is dead code** retained for local-relay debugging — Cloudflare Tunnel returns 524 on >100s time-to-first-byte.
13. Assistant message persisted after stream closes.
14. **Fire-and-forget post-processing (students only)** — `handlePostResponse` in `/src/lib/chat/post-response.ts`:
    - XP award via `awardEvent({ eventType: "chat_session", xp: 10, ... })` + progression engine
    - Discovery signal extraction (discovery stage) or goal extraction (planning stages) via a second LLM call (`provider.generateStructuredResponse`) — JSON-mode
    - Mood extraction
    - Classroom confirmation detection (until `Student.classroomConfirmedAt` is set)
    - Rolling conversation summary compaction (`maybeUpdateSummary`) when message count crosses threshold
    - Conversation title generation
15. Errors inside the stream: logged with `provider.name`, pushed as `data: {"error": ...}\n\n` event, stream closes.

## Layers

### `src/app/*` — Route handlers (UI + API)
- **Purpose:** HTTP entry points only. Pages are React Server Components; API routes return `Response` or `NextResponse.json(...)`.
- **Depends on:** `src/lib/*` for all logic; never imports from `src/components/*` on server.
- **Used by:** Browsers, cron scripts (via `/api/internal/*`), webhook consumers.
- **Rule:** Route handlers are thin adapters. Zero business logic belongs here — route files in `/src/app/api/**/route.ts` call into `/src/lib/**`.

### `src/lib/*` — Domain logic
- **Purpose:** All business rules, data access, external integrations. 100+ modules, feature-grouped.
- **Key sub-namespaces:**
  - `/src/lib/ai/` — AI provider abstraction (cloud vs local)
  - `/src/lib/chat/` — conversation persistence, context building, post-response side effects
  - `/src/lib/sage/` — Sage-specific knowledge, extractors, prompt assembly, coaching arcs
  - `/src/lib/progression/` — XP, streaks, readiness score, event ledger
  - `/src/lib/spokes/` — career clusters, certifications, forms registries
  - `/src/lib/job-board/` — external job scraping adapters + ranking
  - `/src/lib/teacher/` — dashboard aggregations (intervention queue, readiness snapshots)
  - `/src/lib/registry/` — tool registry + auth/audit middleware
- **Depends on:** `prisma` singleton from `./db`; `cached()` from `./cache`; never imports React.
- **Used by:** Route handlers, cron scripts, other lib modules.

### `src/components/*` — Client + server React components
- **Purpose:** UI rendering. Grouped by feature (chat, goals, portfolio, teacher, ui, etc.).
- **Rule:** Server components may do read-only Prisma queries; client components (`"use client"`) call API routes via `fetch`.

### `prisma/` — Schema + migrations
- **Purpose:** Single `visionquest` Postgres schema. 1,244 lines. All tables carry RLS.
- **Migration style:** date-prefixed directories (`20260418120000_add_classroom_confirmed_at_to_student`).

## Key Abstractions

### `AIProvider` interface (`/src/lib/ai/types.ts`)
Three methods: `generateResponse`, `streamResponse` (AsyncGenerator<string>), `generateStructuredResponse` (JSON mode). Two implementations:
- `GeminiProvider` (`/src/lib/ai/gemini-provider.ts`) — `@google/generative-ai` SDK, `systemInstruction` passed to `getGenerativeModel()`, chat history via `model.startChat({ history })`.
- `OllamaProvider` (`/src/lib/ai/ollama-provider.ts`) — raw HTTP, dual-mode detection between OpenAI-compatible and native endpoints (cached per instance in `this.apiMode`). 5-min timeouts tuned for Cloudflare Tunnel heartbeats.

Routes and post-processing always program against `AIProvider`, never the concrete class.

### Tool Registry (`/src/lib/registry/tools.ts`, `/src/lib/registry/types.ts`)
Every capability is a `ToolDefinition` — id (`"sage.chat"`, `"goals.create"`, etc.), required roles, audit level, optional rate limits, optional feature flag, enabled flag. Registry is the single source of truth for what endpoints exist and who can access them. `withRegistry(toolId, handler)` enforces everything declaratively.

### Cache adapter (`/src/lib/cache.ts`)
`CacheAdapter` interface with `InMemoryCacheAdapter` (node-cache) as sole impl. Redis adapter is stubbed with identical signatures — activated by dropping in `ioredis` when multi-instance scaling is needed. Public API: `cached(key, ttlSeconds, fetcher)`, `invalidate(key)`, `invalidatePrefix(prefix)`. Key prefixes are the invalidation unit of work — `session:<id>`, `chat:base-context:<...>`, `sage:documents:<role>`, `sage:snippets`, `webhooks:active`, etc.

### Conversation stages (`ConversationStage` type in `/src/lib/sage/system-prompts.ts`)
14 values: `discovery | onboarding | bhag | monthly | weekly | daily | tasks | checkin | review | orientation | general | teacher_assistant | admin_assistant | career_profile_review`. Stage drives (a) which system prompt is used, (b) which context is loaded (skill-gap / pathway / coaching arc / career profile), (c) whether the heavy knowledge base is included, (d) which optimistic greeting the UI shows before SSE arrives (`STAGE_OPENERS` in `/src/lib/chat/stage-openers.ts`). `admin_assistant` was added in PR #29 (merged today).

### Progression engine (`/src/lib/progression/engine.ts`, `events.ts`)
Event-sourced XP ledger. `awardEvent({ eventType, sourceType, sourceId, xp, mutate })` writes a `ProgressionEvent` row and updates the `Progression` singleton row atomically. Chat sessions, goal confirmations, reviews all flow through here.

### Readiness score (`/src/lib/progression/readiness-score.ts`, `/src/lib/progression/fetch-readiness-data.ts`)
Unified `fetchStudentReadinessData()` is the single entry point for the readiness metric — used by 6 consumers (noted in `CLAUDE.md` decision log).

### Intervention queue (`/src/lib/teacher/intervention-queue.ts`, `/src/lib/intervention-scoring.ts`)
Urgency-scored student list driving the primary teacher dashboard.

## Data Flow: HTTP → Prisma → LLM

```
Browser POST /api/chat/send
  │
  ▼
/src/proxy.ts                    CSRF + CSP nonce
  │
  ▼
/src/app/api/chat/send/route.ts  withRegistry("sage.chat")
  │
  ├─→ getSession() ──────────→ Prisma.student (cached 10s)
  ├─→ resolvePermission() ───→ Prisma.rolePermission (cached 60s)
  ├─→ parseBody(zod) ────────→ validated { message, conversationId, requestedStage }
  ├─→ getProvider() ─────────→ Prisma.systemConfig  →  GeminiProvider | OllamaProvider
  ├─→ rateLimit / quota ─────→ Prisma.rateLimitEntry (serializable tx)
  ├─→ getOrCreate(Teacher?)Conversation ─→ Prisma.conversation
  ├─→ saveMessage(user) ─────→ Prisma.message
  ├─→ getStudentPromptContext ─→ Prisma.goal/orientation/formSubmission/careerDiscovery
  │                             + analyzeSkillGaps + getLearningPathway + getOrCreateCoachingArc
  │                             (each cached 300-600s)
  ├─→ buildSystemPrompt(stage) ─→ string (+ SPOKES_BRIEF or full knowledge base)
  ├─→ getDocumentContext ────→ Prisma.programDocument + Prisma.sageSnippet (cached 300s)
  │
  ▼
provider.streamResponse(systemPrompt, allMessages)
  │                             Gemini: model.startChat().sendMessageStream(...)
  │                             Ollama: POST /v1/chat/completions (stream) or /api/chat
  │
  ▼
SSE stream ───────────→ Browser
  │
  │ (stream completes)
  ▼
saveMessage(assistant) ────→ Prisma.message
maybeUpdateSummary() ──────→ Prisma.conversation (fire-and-forget)
handlePostResponse() ──────→ detectAndRecordClassroomConfirmation  (LLM call)
                           → extractGoals | extractDiscoverySignals (LLM call, JSON mode)
                           → extractMoodFromConversation
                           → awardEvent → Prisma.progressionEvent + Prisma.progression
                           → generateConversationTitle
```

## Auth / Authz Model

| Layer | Mechanism |
|-------|-----------|
| Identity | JWT HS256 in `vq-session` httpOnly cookie (7d), `sameSite: strict`, `secure` in prod. Claims: `{ sub, role, sv }`. Invalidated by bumping `Student.sessionVersion` |
| Session cache | 10s, keyed `session:<id>:<sv>`. Invalidation: `invalidateSessionCache(studentId)` |
| Passwords | scrypt (N=2^15) via `/src/lib/auth.ts`. Legacy PBKDF2 hashes verified + transparently rehashed. `DUMMY_HASH` used in missing-account path to equalize timing |
| MFA | Optional TOTP, 5-min challenge JWT between password step and MFA step. Backup codes hashed with SHA-256. Replay prevention via last-used counter |
| Route group gating | Layouts at `/src/app/(student)/layout.tsx`, `/src/app/(teacher)/layout.tsx`, `/src/app/(admin)/layout.tsx` redirect based on role |
| API authorization | 1. Registry check (`tool.enabled`), 2. `getSession()` (401), 3. `resolvePermission()` against `Role → RolePermission → Permission` tables, 4. Fallback to static `tool.requiredRoles` when RBAC not seeded |
| Cron / internal endpoints | `/api/internal/*` accept `Authorization: Bearer ${CRON_SECRET}`, bypass CSRF check. `isAuthorizedInternalRequest` uses constant-time compare |
| Staff registration | `/api/auth/register-teacher` requires `TEACHER_KEY` env var match |
| Staff roles | `student`, `teacher`, `admin` (plus seeded `coordinator`, `cdc` from migration `20260417120100_seed_coordinator_and_cdc_roles`) |

## Error Handling

- Structured `ApiError` class in `/src/lib/api-error.ts` with factory helpers (`badRequest`, `forbidden`, `notFound`, `conflict`, `rateLimited`). Thrown anywhere, caught by registry middleware.
- Unknown errors → 500. Message surfaced to admins for debuggability, generic to everyone else.
- Logger (`/src/lib/logger.ts`) emits structured JSON in prod, pretty text in dev. Level from `LOG_LEVEL`.
- Sentry captures client errors in `/src/app/error.tsx`; PII scrubbed via `beforeSend` in all three Sentry configs.

## Cross-Cutting Concerns

| Concern | Approach |
|---------|----------|
| CSRF | `Origin` / `Referer` host-match enforced by `/src/proxy.ts` for all state-changing `/api/*` requests; bypassed for `Bearer ${CRON_SECRET}` internal routes |
| CSP | Per-request nonce in `/src/proxy.ts`. `'strict-dynamic'`. Nonce read server-side in `/src/app/layout.tsx` and applied to `<html>` and `<body>` |
| Rate limiting | DB-backed (`/src/lib/rate-limit.ts`). Serializable isolation, retries `P2034` up to 3 times. Survives instance restart. Multi-instance-safe |
| Input validation | Zod schemas in `/src/lib/schemas.ts`. `parseBody(req, schema)` wraps `req.json()` and throws `badRequest` on failure |
| Logging | `logger` throughout. `console.*` limited to (a) health route, (b) `sage.prompt.size` in chat route, (c) logger internals |
| Audit | Registry middleware auto-logs tool access when `auditLevel` set. Explicit `logAuditEvent` for sensitive actions |
| Caching | Single adapter (`/src/lib/cache.ts`), prefix-based invalidation. TTLs: session 10s, RBAC 60s, chat base context 300s, supplemental context 600s, webhooks 60s, Credly badges 10m |
| Theming | Cookie-driven (`THEME_COOKIE`, `/src/lib/theme.ts`). Root layout reads cookie + sets `data-theme` on `<html>`. ESLint guards hardcoded dark-mode-unsafe rgba values |

---

*Architecture analysis: 2026-04-18*
