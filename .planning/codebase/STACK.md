# Technology Stack

**Analysis Date:** 2026-04-18

## Languages

| Language | Version | Where used |
|----------|---------|------------|
| TypeScript | ^5 | All application code (`src/**`, `/e2e/**`) |
| JavaScript (ESM) | — | Ops scripts in `/scripts/*.mjs`, config files (`*.config.mjs`, `eslint.config.mjs`) |
| Python | 3.x | Smoke tests (`/scripts/smoke_*.py`, `/scripts/uat_*.py`, `/scripts/ui_layout_audit.py`), cost analysis |

TypeScript is strict (`"strict": true` in `/tsconfig.json`), targets ES2017, uses `bundler` module resolution, and uses path alias `@/*` → `./src/*`.

## Runtime

| | |
|---|---|
| Node.js | 20 (pinned in `/Dockerfile`: `node:20-alpine`) |
| Next.js runtime | `nodejs` for all API routes; `edge` not used for business logic (edge runtime only instantiates Sentry in `/src/instrumentation.ts`) |
| Package manager | npm (lockfile: `/package-lock.json`) |

## Frameworks

| Framework | Version | Purpose here |
|-----------|---------|--------------|
| Next.js | 16.1.6 | App Router with route groups, React Server Components, standalone output, Turbopack for dev (`/next.config.ts`) |
| React | 19.2.3 | UI |
| Prisma | ^6.19.2 | ORM for PostgreSQL. Client generated at `node_modules/@prisma/client`, schema at `/prisma/schema.prisma` |
| Tailwind CSS | ^4 | Styling via `@tailwindcss/postcss` (`/postcss.config.mjs`), design tokens in `/src/app/globals.css` |
| Zod | ^4.3.6 | Request body validation — parser in `/src/lib/schemas.ts`, consumed by every API route via `parseBody(req, schema)` |

## Build / Dev Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Turbopack | Next 16 built-in | Dev server (`npm run dev`) |
| ESLint | ^9 + eslint-config-next | Linting (`/eslint.config.mjs`) — includes custom `no-restricted-syntax` rule banning hardcoded navy `rgba(18,38,63,...)` / `rgba(16,37,62,...)` to enforce dark-mode tokens |
| TypeScript | ^5 (`tsc --noEmit`) | Type-checking via `npm run typecheck` |
| Playwright | ^1.58.2 | E2E tests in `/e2e/` (`/playwright.config.ts`) — chromium only, dev server auto-started |
| tsx | ^4.20.6 | Runs Node test runner on `.ts` files for unit tests (`npm test` → `tsx --test --experimental-test-module-mocks`) |
| Node.js built-in test runner | — | Used instead of Vitest/Jest; tests colocated as `*.test.ts` |

## Build Output

`next build` emits standalone mode (`output: "standalone"` in `/next.config.ts`, Windows exempted). Production start command:
```
npm run prisma:migrate:deploy && node .next/standalone/server.js
```
See `/render.yaml` and `/Dockerfile`.

## Key Dependencies

### AI & Chat
| Package | Version | Where / why |
|---------|---------|-------------|
| `@google/generative-ai` | ^0.24.1 | Gemini SDK used only in `/src/lib/ai/gemini-provider.ts`. Model is resolved from `process.env.GEMINI_MODEL` with default `gemini-2.5-flash-lite`. `/src/lib/gemini.ts` is a legacy shim kept only for API-key test routes — all inference goes through `/src/lib/ai/provider.ts` |
| (no Ollama SDK) | — | `/src/lib/ai/ollama-provider.ts` speaks raw HTTP to both the OpenAI-compatible `/v1/chat/completions` and native Ollama `/api/chat` endpoints — no npm dep needed |

### Database & Storage
| Package | Version | Where / why |
|---------|---------|-------------|
| `@prisma/client` | ^6.19.2 | Singleton in `/src/lib/db.ts`. Auto-appends `connection_limit` + `pool_timeout` to `DATABASE_URL` from `DB_POOL_SIZE` / `DB_POOL_TIMEOUT` env vars |
| `prisma` | ^6.19.2 | Dev CLI; `postinstall` runs `prisma generate` |
| `@aws-sdk/client-s3` | ^3.1008.0 | S3-compatible client in `/src/lib/storage.ts` — targets Supabase Storage in prod, Cloudflare R2 as legacy fallback, local `./uploads/` in dev |

### Auth
| Package | Version | Where / why |
|---------|---------|-------------|
| `jsonwebtoken` | ^9.0.3 | HS256 JWT sign/verify in `/src/lib/auth.ts` — session cookie `vq-session`, 7-day TTL, plus 5-min MFA challenge tokens |
| `cookie` | ^1.1.1 | httpOnly cookie parsing (used via `next/headers` `cookies()`) |
| `google-auth-library` | ^10.6.2 | Google OAuth code flow in `/src/app/api/auth/google/` |
| (Node `crypto`) | built-in | Password hashing is scrypt (N=2^15, r=8, p=1) with legacy PBKDF2-SHA512 verify + transparent rehash. Hash format: `scrypt$<salt>$<hash>`. API key encryption is AES-256-GCM (`/src/lib/crypto.ts`) |

### UI
| Package | Version | Purpose |
|---------|---------|---------|
| `@phosphor-icons/react` | ^2.1.10 | Icon set |
| `framer-motion` | ^12.38.0 | Page transitions, celebrations (`/src/components/ui/LevelUpCelebration.tsx`) |
| `clsx` + `tailwind-merge` | ^2.1.1 / ^3.5.0 | `cn()` utility in `/src/lib/utils.ts` |

### Observability
| Package | Version | Purpose |
|---------|---------|---------|
| `@sentry/nextjs` | ^10.43.0 | Client / server / edge configs at `/sentry.*.config.ts`. PII scrubber in `/src/lib/sentry-scrub.ts`. Source maps only uploaded when `SENTRY_AUTH_TOKEN` is set. In-app usage intentionally minimal — only `/src/app/error.tsx` and the scrubber import it directly |

### Document / File processing
| Package | Version | Where |
|---------|---------|-------|
| `pdf-parse` | ^2.4.5 | Resume/document text extraction (`/src/lib/resume-extract.ts`, `/src/lib/sage/extract.ts`) |
| `mammoth` | ^1.12.0 | DOCX → text extraction (same files) |
| `jspdf` | ^4.2.1 | Generated PDFs (`/src/lib/resume-pdf.ts`, `/src/lib/certificate-generator.ts`) |
| `archiver` | ^7.0.1 | Student archive ZIP exports (`/src/lib/student-archive.ts`) |

### Communication
| Package | Version | Where |
|---------|---------|-------|
| `nodemailer` | ^7.0.5 | SMTP sending in `/src/lib/email.ts`. Imported dynamically so the service silently no-ops when `SMTP_*` env vars are absent |
| (Twilio HTTP only) | — | `/src/lib/sms.ts` calls the Twilio REST API directly via `fetch` — no SDK |

### Caching / Rate limiting
| Package | Version | Where |
|---------|---------|-------|
| `node-cache` | ^5.1.2 | Backs the in-memory `CacheAdapter` in `/src/lib/cache.ts`. TTL 60s default, 10k max keys. Redis adapter is stubbed out in comments for when multi-instance scaling happens |
| (Prisma) | — | Rate limiting is DB-backed via `RateLimitEntry` table + serializable transaction in `/src/lib/rate-limit.ts` — not in-memory, so it survives instance restarts |

## Configuration Files

| File | Purpose |
|------|---------|
| `/next.config.ts` | Standalone build, static security headers (HSTS, X-Frame-Options, Permissions-Policy). CSP intentionally omitted here — set per-request in `/src/proxy.ts` |
| `/tsconfig.json` | Strict TS, `@/*` alias, excludes `**/__tests__/**` from build |
| `/eslint.config.mjs` | Next.js core-web-vitals + TS + dark-mode rgba guard |
| `/postcss.config.mjs` | Tailwind 4 plugin |
| `/playwright.config.ts` | E2E against `localhost:3000`, auto-starts `npm run dev` |
| `/prisma/schema.prisma` | Single schema `visionquest` in Postgres, 1,244 lines |
| `/render.yaml` | Web service + 3 cron jobs, env var manifest |
| `/Dockerfile` | `node:20-alpine` multi-stage, runs as non-root `nextjs:nodejs` user |

## Hosting / Runtime

| | |
|---|---|
| Host | Render.com (free tier) |
| Service definition | `/render.yaml` (one `web` + three `cron` workers) |
| Database | Supabase PostgreSQL (pooled + direct URLs) |
| Storage | Supabase Storage via S3-compatible API |
| Cold start | 30-60s (free-tier instance sleep) — noted in `CLAUDE.md` |

## Scripts

Common operational scripts at `/scripts/`:

| Script | Purpose |
|--------|---------|
| `seed-data.mjs` | Dev data seeding (`npm run db:seed`) |
| `seed-rbac.ts` | RBAC Role/Permission table seeding |
| `seed-documents.mjs` / `seed-sage-context.mjs` | ProgramDocument + SageSnippet seeding for RAG layer (RAG dormant — see `INTEGRATIONS.md`) |
| `promote-teacher.mjs` / `promote-admin.mjs` | Role upgrades |
| `run-appointment-reminders.mjs` / `run-job-processor.mjs` / `run-daily-coaching.mjs` | Cron entry points declared in `/render.yaml` |
| `ollama-relay.mjs` + `start-sage-tunnel.bat` | Local-AI relay prototype for upcoming Mac Studio self-host |
| `upload-to-supabase.mjs` | One-time Supabase Storage upload helper |

---

*Stack analysis: 2026-04-18*
