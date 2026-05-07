# Codebase Structure

**Analysis Date:** 2026-04-18

## Top-Level Layout

```
/Users/brittlegg/visionquest/
├── src/                    All application code
├── prisma/                 DB schema + 40+ dated migrations
├── e2e/                    Playwright E2E tests (3 files)
├── scripts/                Ops scripts (seed, promote, cron entry points, relays, UAT)
├── content/                SPOKES program docs (Markdown + PDFs) — bundled, not in DB
├── config/                 Misc config (small)
├── public/                 Static assets
├── docs/                   Planning, PRDs, cost analyses, audits
│   ├── PRODUCT_GUIDE.md         (authoritative product guide)
│   ├── PRODUCT_DECISIONS.md     (authoritative scope framework)
│   ├── plans/                   (live implementation plans)
│   ├── superpowers/plans/       (long-form redesign plans)
│   ├── archive/                 (frozen — do not read)
│   └── audits/                  (one-off audits)
├── CLAUDE.md               Agent onboarding + architecture notes (read first)
├── DEPLOY.md               Deployment notes
├── README.md               Developer setup
├── render.yaml             Render.com service manifest
├── Dockerfile              Multi-stage node:20-alpine
├── next.config.ts          Standalone build + static security headers
├── tsconfig.json           `@/*` → `./src/*`
├── eslint.config.mjs       Custom rgba() guard for dark-mode safety
├── postcss.config.mjs      Tailwind v4
├── playwright.config.ts    E2E against localhost:3000 or BASE_URL
├── sentry.*.config.ts      Client / server / edge Sentry init (3 files)
└── package.json            All deps (no devDeps — Render strips them in prod)
```

## `src/` Layout

```
src/
├── app/                    Next.js App Router (route handlers + pages)
│   ├── layout.tsx          Root layout: fonts, CSP nonce pickup, theme cookie
│   ├── page.tsx            Landing page
│   ├── globals.css         Tailwind v4 + design token CSS variables
│   ├── error.tsx           App-level error boundary (Sentry capture)
│   ├── (student)/          Role-gated route group: student UI
│   ├── (teacher)/          Role-gated route group: teacher UI
│   ├── (admin)/            Role-gated route group: admin UI
│   ├── api/                API routes (see below)
│   ├── coordinator/        Standalone role landing (coordinator)
│   ├── cdc/                Standalone role landing (cdc)
│   ├── credentials/[slug]/ Public credential verification page
│   ├── teacher-register/   Separate onboarding page (requires TEACHER_KEY)
│   ├── forgot-password/    Password reset flow (public)
│   └── reset-password/     Password reset flow (public)
│
├── components/             React components, grouped by feature (see below)
├── lib/                    All domain logic (see below)
├── proxy.ts                Next 16 proxy: CSRF + CSP nonce + X-API-Version
├── instrumentation.ts      Boot-time env validation + Sentry init
└── types/                  Shared TypeScript type declarations
```

## Route Groups

Next.js route groups (parenthesized folders) apply a layout without adding a URL segment. Layout files redirect users out of route groups they don't have access to.

| Group | Path | Who | Contents |
|-------|------|-----|----------|
| `(student)` | `/src/app/(student)/` | role=student | `chat`, `dashboard`, `goals`, `orientation`, `portfolio`, `career`, `vision-board`, `files`, `resources`, `learning`, `jobs`, `profile`, `settings`, `appointments`, `welcome` |
| `(teacher)` | `/src/app/(teacher)/teacher/` | role=teacher \| admin | `page.tsx` (dashboard), `chat`, `classes`, `manage`, `orientation`, `students` |
| `(admin)` | `/src/app/(admin)/admin/` | role=admin | `page.tsx`, `chat` (admin Sage added in PR #29) |

## `src/app/api/` Layout

```
api/
├── admin/              ai-config, ai-provider, registry, webhooks
├── applications/       job applications
├── appointments/       advising appointments
├── auth/               login, google (+ callback), mfa, register-teacher,
│                       forgot-password, reset-password, session
├── certifications/     certification CRUD
├── chat/               send, conversations, history, warmup
├── class/              student-facing class views
├── credentials/        public credential endpoints
├── credly/badges/      Credly public-API proxy
├── cron/               evidence-gap-detection, goal-stale-detection
├── csp-report/         CSP violation report sink
├── documents/          ProgramDocument download + list
├── events/             career events
├── files/              file upload/download
├── forms/              FormSubmission CRUD
├── goal-resource-links/
├── goals/
├── health/             public — Render uses as healthcheck
├── internal/           cron-hit routes — auth via CRON_SECRET (alerts,
│                       appointments, coaching, jobs, reports)
├── jobs/               job board (student view)
├── lms/                LMS integration stubs
├── mood/               mood entries
├── notifications/
├── opportunities/
├── orientation/
├── portfolio/
├── progression/
├── resume/
├── settings/           includes /settings/credly
├── tasks/              StudentTask CRUD
├── teacher/            teacher-only routes: dashboard, intervention-queue,
│                       students, classes, reports (+ grant-kpi), exports,
│                       audit, spokes, sage-snippets, welcome-letter, …
└── vision-board/
```

## `src/lib/` Layout

100+ modules, organized by feature. Key sub-namespaces:

| Path | Purpose |
|------|---------|
| `ai/` | Provider abstraction: `provider.ts`, `gemini-provider.ts`, `ollama-provider.ts`, `types.ts`, `health.ts`, `local-auth.ts`, `index.ts` |
| `chat/` | `conversation.ts`, `context.ts`, `post-response.ts`, `summarizer.ts`, `commands.ts`, `stage-openers.ts`, `api-key.ts` |
| `sage/` | `system-prompts.ts`, `knowledge-base.ts`, `personality.ts`, `goal-extractor.ts`, `mood-extractor.ts`, `discovery-extractor.ts`, `classroom-confirmation.ts`, `coaching-arcs.ts`, `daily-prompts.ts`, `skill-gap.ts`, `extract.ts`, `ingest.ts` |
| `progression/` | `engine.ts`, `events.ts`, `service.ts`, `readiness-score.ts`, `fetch-readiness-data.ts` |
| `spokes/` | `career-clusters.ts`, `certifications.ts`, `forms.ts`, `goal-matcher.ts`, `national-clusters.ts`, `platforms.ts` |
| `job-board/` | `adapters/`, `cluster-matcher.ts`, `recommendation.ts`, `salary-parser.ts`, `scrape-engine.ts`, `types.ts` |
| `teacher/` | `dashboard.ts`, `intervention-queue.ts`, `readiness-snapshot.ts` |
| `registry/` | `tools.ts` (single source of truth for capabilities), `middleware.ts` (`withRegistry`), `types.ts`, `index.ts` |
| `__tests__/` | Cross-module integration tests that don't belong to one module |

**Top-level `lib/` files** (selected — alphabetical, not exhaustive):
| File | Purpose |
|------|---------|
| `auth.ts` | Passwords, JWT, session cookie, MFA tokens |
| `db.ts` | Prisma client singleton |
| `cache.ts` | In-memory cache adapter + Redis stub |
| `csrf.ts` | Origin/host matcher, internal-route auth |
| `crypto.ts` | AES-256-GCM encrypt/decrypt for API keys, MFA secrets |
| `env.ts` | Runtime env validation (called from `instrumentation.ts`) |
| `logger.ts` | Structured JSON logger |
| `audit.ts` | `AuditEvent` writer |
| `rbac.ts` | Role→RolePermission resolver with 60s cache |
| `rate-limit.ts` | DB-backed rate limits |
| `schemas.ts` | Zod schemas + `parseBody(req, schema)` |
| `api-error.ts` | `ApiError` class, `withAuth`, `withAdminAuth`, factory helpers |
| `storage.ts` | S3-compatible file storage (Supabase / R2 / local disk) |
| `email.ts` / `sms.ts` | Optional SMTP / Twilio, no-op when unconfigured |
| `webhooks.ts` | Outgoing signed webhook dispatch |
| `rls-context.ts` | Future-state RLS GUC helpers (not active) |
| `theme.ts` | Theme cookie read/write |
| `nav-items.ts` / `role-home.ts` | Navigation configuration |
| `gemini.ts` | **Legacy shim** — kept only for the API-key test route. Real inference goes through `lib/ai/` |

## `src/components/` Layout

Grouped by feature; each folder holds the client/server components for that surface.

| Folder | Key contents |
|--------|---------|
| `chat/` | `ChatWindow.tsx`, `ChatInput.tsx`, `MessageBubble.tsx`, `ConversationList.tsx`, `TypingIndicator.tsx`, `StarterChips.tsx`, `CommandPalette.tsx`, `SageMiniChat.tsx` |
| `ui/` | Design-system primitives: `NavBar`, `BrandLockup`, `PageIntro`, `ReadinessScore`, `MountainProgress`, `XpBar`, `StreakBadge`, `ThemeProvider`, `ThemeToggle`, `AchievementList`, `AchievementUnlock`, `LevelUpCelebration`, `NotificationBell`, `NotificationProvider`, `SignaturePad`, `PageTransition`, `FormUploadButton`, `CertificateDownload`, `SuggestedActions`, `CohortCard`, etc. |
| `goals/`, `advising/`, `career/`, `certifications/`, `documents/`, `files/`, `jobs/`, `lms/`, `orientation/`, `portfolio/`, `progression/`, `resources/`, `spokes/`, `teacher/`, `vision-board/` | Feature-specific components |
| `auth/` | Auth forms + flows |

## `prisma/`

```
prisma/
├── schema.prisma           Single `visionquest` schema (1,244 lines)
├── dev.db                  SQLite for local dev (not checked in to prod path)
└── migrations/             40+ dated dirs (YYYYMMDDHHMMSS_name/)
    ├── …03060000_rls_remaining_tables/
    ├── …03080000_message_student_id_not_null/
    ├── …03090000_rbac_tables/
    ├── …04150000_enable_rls_all_remaining_tables/
    ├── …04170000_add_program_type_to_class/
    ├── …04170100_seed_coordinator_and_cdc_roles/
    └── …04180000_add_classroom_confirmed_at_to_student/   ← most recent
```

## `e2e/` (Playwright)

Three spec files; each covers a user role's critical path:
- `/e2e/public-routes.spec.ts` — unauthenticated surfaces
- `/e2e/student-login-chat.spec.ts` — student happy path through login → chat
- `/e2e/teacher-dashboard.spec.ts` — teacher dashboard + intervention queue

Config (`/playwright.config.ts`): Chromium only, auto-starts `npm run dev`, BASE_URL overridable.

## `scripts/`

| Script | Run via | Purpose |
|--------|---------|---------|
| `seed-data.mjs` | `npm run db:seed` | Development data seeding |
| `seed-documents.mjs` | `npm run db:seed-documents` | ProgramDocument seeding for RAG layer |
| `seed-sage-context.mjs` | `npm run seed:sage-context` | SageSnippet seeding |
| `seed-rbac.ts` | `tsx scripts/seed-rbac.ts` | RBAC Role + Permission rows |
| `promote-teacher.mjs` | `npm run users:promote-teacher` | Role bump |
| `promote-admin.mjs` | `npm run users:promote-admin` | Role bump |
| `run-appointment-reminders.mjs` | Render cron (hourly) | Calls `/api/internal/appointments/reminders` with `Bearer $CRON_SECRET` |
| `run-job-processor.mjs` | Render cron (every 10 min) | Job board scrape trigger |
| `run-daily-coaching.mjs` | Render cron (13:00 UTC) | Daily coaching arcs |
| `run-smoke-public-routes.mjs` | `npm run test:smoke` | Smoke test against running server |
| `smoke_public_routes.py` / `smoke_api_routes.py` | `npm run test:smoke:api` | Python smoke tests |
| `uat_auth_chat.py` / `uat_security_question_reset.py` | ad hoc | Manual UAT helpers |
| `ui_layout_audit.py` | ad hoc | Layout audit (Playwright under Python) |
| `ollama-relay.mjs` / `start-sage-tunnel.bat` | ad hoc (dev-only) | Prototype Cloudflare Tunnel relay for upcoming local-AI deploy |
| `upload-to-supabase.mjs` | one-off | Supabase Storage uploader |
| `fix-hardcoded-theme-colors.mjs` | one-off | Codemod for dark-mode migration |
| `md_to_pdf_cost_analysis.py` | one-off | Cost report generator |

## Test Colocation

| Kind | Location | Runner |
|------|----------|--------|
| Unit / integration | Colocated `*.test.ts` next to source (e.g. `/src/lib/auth.ts` → `/src/lib/auth.test.ts`) | Node built-in test runner via `tsx --test --experimental-test-module-mocks` (`npm test`) |
| API route handler tests | `/src/app/api/**/*.test.ts` (e.g. `/src/app/api/admin/ai-provider/route.test.ts`) | `npm run test:api` |
| Component tests | Colocated `*.test.tsx` next to component (e.g. `/src/components/chat/CommandPalette.test.tsx`) | Same Node test runner |
| E2E | `/e2e/*.spec.ts` | `npm run test:e2e` (Playwright) |
| Smoke (public routes) | `/scripts/smoke_*.py`, `/scripts/run-smoke-public-routes.mjs` | `npm run test:smoke`, `npm run test:smoke:api` |

`tsconfig.json` excludes `**/__tests__/**` but *not* colocated `*.test.ts` — tests compile for the runner but are irrelevant to the Next build.

## Configuration Files

| File | Responsibility |
|------|---------------|
| `/next.config.ts` | Standalone output, Turbopack root, static security headers (HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy) — CSP is NOT set here; it's per-request in `/src/proxy.ts` |
| `/tsconfig.json` | Strict TS, `@/*` alias, `moduleResolution: bundler`, ES2017 target |
| `/postcss.config.mjs` | Tailwind v4 plugin |
| `/eslint.config.mjs` | `eslint-config-next` + typed unused-vars warning + `no-restricted-syntax` guard blocking hardcoded navy rgba values |
| `/playwright.config.ts` | `./e2e` testDir, Chromium, auto-start dev server |
| `/render.yaml` | One web service + three cron workers, env var catalog |
| `/Dockerfile` | Multi-stage node:20-alpine → standalone output, runs as non-root `nextjs:nodejs` |
| `/sentry.client.config.ts`, `/sentry.server.config.ts`, `/sentry.edge.config.ts` | Three distinct Sentry inits, all gated on DSN presence, all use PII scrubber |
| `/prisma/schema.prisma` | Prisma schema, one Postgres schema `visionquest` |

## Where to Add New Code

| You're adding… | Put it here |
|-----------------|-------------|
| New student-facing page | `/src/app/(student)/<feature>/page.tsx` (+ sibling `layout.tsx` if needed) |
| New teacher page | `/src/app/(teacher)/teacher/<feature>/page.tsx` |
| New admin page | `/src/app/(admin)/admin/<feature>/page.tsx` |
| New API endpoint | `/src/app/api/<namespace>/<action>/route.ts` — must be wrapped by `withRegistry(toolId, handler)`. First, register the tool in `/src/lib/registry/tools.ts` |
| New cron-triggered endpoint | `/src/app/api/internal/<name>/route.ts` — gets `Authorization: Bearer $CRON_SECRET` enforced by `/src/proxy.ts` + `/src/lib/csrf.ts`. Add the cron service to `/render.yaml` and the entry-point script to `/scripts/run-<name>.mjs` |
| New business logic | `/src/lib/<namespace>/<file>.ts` — group with existing sub-namespace if one fits (`chat/`, `sage/`, `progression/`, `spokes/`, `teacher/`, etc.) |
| New Zod schema | Append to `/src/lib/schemas.ts` (or colocate if tightly coupled to one route) |
| New React component | `/src/components/<feature>/<Name>.tsx`. Shared primitives go in `/src/components/ui/` |
| New design token | `/src/app/globals.css` (CSS custom properties). Do not hardcode hex values in component styles |
| New Prisma migration | `npx prisma migrate dev --name <snake_case>` → new dir in `/prisma/migrations/` |
| New AI capability | Likely a new method on `AIProvider` interface (`/src/lib/ai/types.ts`) + impls on both `GeminiProvider` and `OllamaProvider`, not a new provider |
| New external integration | `/src/lib/<name>.ts` (top-level) if it's a communication channel like `email.ts` / `sms.ts`; otherwise group under an existing namespace |
| New test | Colocated `*.test.ts` next to the source file |
| New E2E flow | `/e2e/<feature>.spec.ts` |
| New ops script | `/scripts/<verb>-<noun>.mjs` |

## Naming Conventions

| Kind | Pattern | Example |
|------|---------|---------|
| Files (TS source) | kebab-case or camelCase | `system-prompts.ts`, `auth.ts` |
| Components | PascalCase, single file per component | `ChatWindow.tsx`, `BrandLockup.tsx` |
| API routes | `route.ts` inside a path segment folder | `/src/app/api/chat/send/route.ts` |
| Tests | Source basename + `.test.ts(x)`, colocated | `auth.ts` → `auth.test.ts` |
| Migrations | `YYYYMMDDHHMMSS_snake_case/` | `20260418120000_add_classroom_confirmed_at_to_student/` |
| Tool IDs (registry) | `namespace.action` | `sage.chat`, `goals.create`, `auth.login` |
| Ops scripts | `verb-noun.mjs` (or `.ts`) | `seed-rbac.ts`, `promote-teacher.mjs`, `run-job-processor.mjs` |
| Cache keys | colon-delimited prefix | `session:<id>:<sv>`, `chat:base-context:<studentId>:<conversationId>:<stage>`, `sage:documents:<role>` |
| Cron endpoints | under `/api/internal/` | `/api/internal/appointments/reminders` |

## Special Directories

| Directory | Committed | Purpose |
|-----------|-----------|---------|
| `.next/` | No | Next.js build output |
| `.planning/codebase/` | Yes | GSD mapper output (this file set) |
| `content/` | Yes | SPOKES program reference docs — indexed by `/content/_INDEX.md`, surfaced as bundled fallbacks by `/src/lib/storage.ts#downloadBundledFile` |
| `uploads/` | No | Local dev file storage (S3-equivalent fallback) |
| `docs-upload/` | **Does not exist** | Intended bundled RAG grounding docs — referenced in `/src/lib/storage.ts` but no directory on disk. See `INTEGRATIONS.md` → Dormant |
| `docs/archive/` | Yes | Frozen planning artifacts — do not read unless asked |

---

*Structure analysis: 2026-04-18*
