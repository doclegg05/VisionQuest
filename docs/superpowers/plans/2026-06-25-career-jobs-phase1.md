# Career Jobs — Phase 1 Implementation Plan (Browse pool + clean display + loop fix)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student with no profile and an unconfigured class sees real, fresh jobs immediately (a program-wide keyless "browse" pool), the Local/Remote/All counts never render `NaN`, and the Career Discovery chat no longer loops back to `/career`.

**Architecture:** Add a program-scoped `JobBrowseListing` table populated by the existing keyless adapters via a new `runBrowseRefresh()` (mirrors `runScrapeForConfig` but config-free). `GET /api/jobs` falls back to the browse pool whenever there are no class-scoped local jobs, and every response path returns numeric `totalLocal/totalRemote/totalActive`. Anti-stale is enforced by a new pure `freshness` module that sets `expiresAt` at ingest and drops anything older than the max-age. The discovery loop is killed by removing the self-referential `career-discovery` static resource.

**Tech Stack:** Next.js 16 (App Router), Prisma 6 (Postgres `visionquest` schema), TypeScript strict, `node:test` + `node:assert/strict` unit tests.

## Global Constraints

- Prisma models use `@@schema("visionquest")`, `id String @id @default(cuid())`, `createdAt`/`updatedAt` timestamps. (verbatim from `.claude/rules/prisma-conventions.md`)
- Prisma queries live in `src/lib/` helpers, never inline in route handlers. Always `select`/`include` to limit fields.
- Run `npx prisma validate` after every schema edit; review generated SQL for unintended DROPs before commit.
- API responses: `{ ... }` JSON; never leak raw Prisma errors. CSRF + `withAuth` already wrap routes.
- TypeScript strict — no `any` (use `unknown` + narrowing). Named exports for utilities; explicit types on exported functions.
- No `console.log` — use `@/lib/logger`.
- Run tests with (Windows-safe): `npx tsx --test --experimental-test-module-mocks $(git ls-files 'src/**/*.test.ts')` — or target one file: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/<file>.test.ts`.
- Conventional commit messages; one commit per task. Do NOT skip hooks or force-push.
- Anti-stale max-age constant: **45 days**. Browse refresh cadence: **daily, 23h debounce** (operator pg_cron, like RAG backfill).

---

## File Structure (Phase 1)

| File | Responsibility | New/Mod |
|------|----------------|---------|
| `prisma/schema.prisma` | `JobBrowseListing` model (program-scoped pool) | Mod |
| `src/lib/job-board/freshness.ts` | Pure: `resolveExpiry`, `isFresh`, `MAX_JOB_AGE_DAYS` | New |
| `src/lib/job-board/freshness.test.ts` | Tests for freshness | New |
| `src/lib/job-board/types.ts` | Add `postedAt?: string \| null` to `NormalizedJob` | Mod |
| `src/lib/job-board/browse-sources.ts` | `BROWSE_SOURCES` keyless allowlist | New |
| `src/lib/job-board/browse-scrape.ts` | `runBrowseRefresh()` — fetch keyless → quality → freshness → upsert `JobBrowseListing` | New |
| `src/lib/job-board/browse-scrape.test.ts` | Tests for browse refresh (fake adapter + mocked prisma) | New |
| `src/lib/job-board/browse-jobs.ts` | `loadBrowseJobs(filters)` — read pool for the API; maps to the same job shape | New |
| `src/lib/job-board/browse-jobs.test.ts` | Tests for `loadBrowseJobs` | New |
| `src/app/api/jobs/route.ts` | Browse fallback + always-numeric counts + decoupled personalization | Mod |
| `src/app/api/internal/jobs/browse-refresh/route.ts` | `POST` cron endpoint (CRON_SECRET) → `runBrowseRefresh()` | New |
| `scripts/run-browse-refresh.mjs` | Manual trigger fallback | New |
| `src/components/jobs/JobFilters.tsx` | `safeCount` guard (no `NaN`) | Mod |
| `src/components/career/CareerHub.tsx` | Default proximity `"all"`, default counts `?? 0`, posted-date + source badge on cards | Mod |
| `src/lib/sage/agent/tools.ts` | Remove `career-discovery` from `STATIC_RESOURCES` (kill loop) | Mod |
| `src/lib/sage/agent/tools.test.ts` | Assert `career-discovery` is gone + `open_resource` rejects it | New/Mod |

> **Scope note:** the affirmative "forward action on completion" (a *See your job matches* card after discovery completes) is deferred to **Phase 2**, where profile→jobs linkage lives. Phase 1's loop fix is the surgical removal of the self-referential resource so Sage stops offering a back-link to `/career` from inside the discovery chat. This is an intentional, logged scope boundary — not a silent drop.

---

## Task 1: `JobBrowseListing` model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add model after `JobListing`, ~line 1422)

**Interfaces:**
- Produces: Prisma model `JobBrowseListing` with fields `{ id, title, company, location, workMode, salary, salaryMin, employmentType, description, url, source, sourceType, sourceId, clusters, status, postedAt, expiresAt, scrapeBatchId, createdAt, updatedAt }`, `@@unique([source, sourceId])`, `@@index([status, postedAt])`. Prisma client model `prisma.jobBrowseListing`.

- [ ] **Step 1: Add the model to schema.prisma**

```prisma
/// Program-wide browse pool: keyless remote/ATS jobs, not class-scoped.
/// Lets any student browse the market with zero teacher setup.
model JobBrowseListing {
  id             String    @id @default(cuid())
  title          String
  company        String
  location       String
  workMode       String    @default("remote")
  salary         String?
  salaryMin      Float?
  employmentType String?
  description    String    @db.Text
  url            String
  source         String
  sourceType     String
  sourceId       String
  clusters       String[]  @default([])
  status         String    @default("active") // active | expired
  postedAt       DateTime?
  expiresAt      DateTime?
  scrapeBatchId  String
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@unique([source, sourceId])
  @@index([status, postedAt])
  @@index([status, workMode])
  @@schema("visionquest")
}
```

- [ ] **Step 2: Validate schema**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid 🚀`

- [ ] **Step 3: Create the migration (review SQL before applying)**

Run: `npx prisma migrate dev --name add_job_browse_listing --create-only`
Then open the generated `prisma/migrations/*_add_job_browse_listing/migration.sql` and confirm it contains only `CREATE TABLE "visionquest"."JobBrowseListing"` + indexes — **no DROP**.

- [ ] **Step 4: Apply + regenerate client**

Run: `npx prisma migrate dev` then `npx prisma generate`
Expected: migration applies; `prisma.jobBrowseListing` is available on the client.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(jobs): add JobBrowseListing program-wide browse pool model"
```

---

## Task 2: Freshness module (anti-stale core)

**Files:**
- Create: `src/lib/job-board/freshness.ts`
- Test: `src/lib/job-board/freshness.test.ts`

**Interfaces:**
- Produces:
  - `export const MAX_JOB_AGE_DAYS = 45;`
  - `export function resolveExpiry(postedAt: Date | null, scrapedAt: Date, ttlDays?: number): Date` — returns `postedAt + ttlDays` if `postedAt` given, else `scrapedAt + ttlDays` (default `ttlDays = MAX_JOB_AGE_DAYS`).
  - `export function isFresh(postedAt: Date | null, now: Date, maxAgeDays?: number): boolean` — `true` if `postedAt` is null (unknown → keep) or within `maxAgeDays`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/job-board/freshness.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveExpiry, isFresh, MAX_JOB_AGE_DAYS } from "./freshness";

const DAY = 24 * 60 * 60 * 1000;

test("resolveExpiry uses postedAt + ttl when posted date is known", () => {
  const posted = new Date("2026-06-01T00:00:00Z");
  const scraped = new Date("2026-06-20T00:00:00Z");
  const expiry = resolveExpiry(posted, scraped, 30);
  assert.equal(expiry.getTime(), posted.getTime() + 30 * DAY);
});

test("resolveExpiry falls back to scrapedAt + ttl when postedAt is null", () => {
  const scraped = new Date("2026-06-20T00:00:00Z");
  const expiry = resolveExpiry(null, scraped, 30);
  assert.equal(expiry.getTime(), scraped.getTime() + 30 * DAY);
});

test("resolveExpiry default ttl is MAX_JOB_AGE_DAYS", () => {
  const scraped = new Date("2026-06-20T00:00:00Z");
  const expiry = resolveExpiry(null, scraped);
  assert.equal(expiry.getTime(), scraped.getTime() + MAX_JOB_AGE_DAYS * DAY);
});

test("isFresh keeps unknown postedAt (null) and recent jobs, drops old ones", () => {
  const now = new Date("2026-06-25T00:00:00Z");
  assert.equal(isFresh(null, now), true);
  assert.equal(isFresh(new Date("2026-06-20T00:00:00Z"), now, 45), true);
  assert.equal(isFresh(new Date("2026-04-01T00:00:00Z"), now, 45), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/freshness.test.ts`
Expected: FAIL — cannot find module `./freshness`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/job-board/freshness.ts
/** Maximum age (days) a job may have before it is considered stale. */
export const MAX_JOB_AGE_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute an expiry timestamp for a job at ingest time.
 * Prefers the source's posted date; falls back to scrape time.
 */
export function resolveExpiry(
  postedAt: Date | null,
  scrapedAt: Date,
  ttlDays: number = MAX_JOB_AGE_DAYS,
): Date {
  const base = postedAt ?? scrapedAt;
  return new Date(base.getTime() + ttlDays * DAY_MS);
}

/**
 * Whether a job is fresh enough to show. Unknown posted dates are kept
 * (null = keep) so we never silently hide listings whose age we can't verify.
 */
export function isFresh(
  postedAt: Date | null,
  now: Date,
  maxAgeDays: number = MAX_JOB_AGE_DAYS,
): boolean {
  if (postedAt === null) return true;
  return now.getTime() - postedAt.getTime() <= maxAgeDays * DAY_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/freshness.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/job-board/freshness.ts src/lib/job-board/freshness.test.ts
git commit -m "feat(jobs): add freshness module for anti-stale expiry + max-age"
```

---

## Task 3: Add `postedAt` to `NormalizedJob` + browse source allowlist

**Files:**
- Modify: `src/lib/job-board/types.ts:5-18` (add field)
- Create: `src/lib/job-board/browse-sources.ts`
- Test: `src/lib/job-board/browse-sources.test.ts`

**Interfaces:**
- Produces:
  - `NormalizedJob.postedAt?: string | null` (ISO string from adapters; optional/best-effort).
  - `export const BROWSE_SOURCES: readonly string[]` — keyless adapter keys: `["remotive","remoteok","weworkremotely","arbeitnow","greenhouse","lever","ashby","smartrecruiters"]`.
  - `export function browseAdapters(): JobSourceAdapter[]` — `ALL_JOB_SOURCE_ADAPTERS` filtered to `BROWSE_SOURCES` that are `isConfigured()`.

- [ ] **Step 1: Add `postedAt` to the `NormalizedJob` interface**

In `src/lib/job-board/types.ts`, inside `interface NormalizedJob`, add after `sourceId: string;`:

```ts
  /** ISO date the job was posted at source, when available. */
  postedAt?: string | null;
```

- [ ] **Step 2: Write the failing test for browse-sources**

```ts
// src/lib/job-board/browse-sources.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { BROWSE_SOURCES, browseAdapters } from "./browse-sources";

test("BROWSE_SOURCES contains only keyless remote/ATS sources", () => {
  assert.deepEqual([...BROWSE_SOURCES].sort(), [
    "arbeitnow", "ashby", "greenhouse", "lever",
    "remoteok", "remotive", "smartrecruiters", "weworkremotely",
  ]);
});

test("browseAdapters returns adapters whose source is in BROWSE_SOURCES and are configured", () => {
  const adapters = browseAdapters();
  assert.ok(adapters.length > 0);
  for (const a of adapters) {
    assert.ok(BROWSE_SOURCES.includes(a.source));
    assert.equal(a.isConfigured(), true);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/browse-sources.test.ts`
Expected: FAIL — cannot find module `./browse-sources`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/job-board/browse-sources.ts
import { ALL_JOB_SOURCE_ADAPTERS } from "./adapters/registry";
import type { JobSourceAdapter } from "./types";

/** Keyless sources that power the program-wide browse pool (no API keys). */
export const BROWSE_SOURCES = [
  "remotive",
  "remoteok",
  "weworkremotely",
  "arbeitnow",
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
] as const;

const BROWSE_SET = new Set<string>(BROWSE_SOURCES);

export function browseAdapters(): JobSourceAdapter[] {
  return ALL_JOB_SOURCE_ADAPTERS.filter(
    (a) => BROWSE_SET.has(a.source) && a.isConfigured(),
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/browse-sources.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Populate `postedAt` in keyless adapters (best-effort)**

For each adapter in `src/lib/job-board/adapters/` whose upstream JSON exposes a date, map it to `postedAt` as an ISO string; otherwise leave it unset. Known date fields:
- `remoteok.ts`: `date` field → `new Date(job.date).toISOString()`.
- `weworkremotely.ts`: RSS `pubDate` → `new Date(job.pubDate).toISOString()`.
- `arbeitnow.ts`: `created_at` (unix seconds) → `new Date(job.created_at * 1000).toISOString()`.
- `greenhouse.ts`/`lever.ts`/`ashby.ts`/`smartrecruiters.ts`: `updated_at`/`createdAt`/`publishedAt` where present.
- `remotive.ts`: no reliable date in current mapping → leave `postedAt` unset (null).

Add `postedAt` to each adapter's returned object next to `sourceId`. Do not invent dates.

- [ ] **Step 7: Commit**

```bash
git add src/lib/job-board/types.ts src/lib/job-board/browse-sources.ts src/lib/job-board/browse-sources.test.ts src/lib/job-board/adapters
git commit -m "feat(jobs): add postedAt to NormalizedJob + keyless browse-source allowlist"
```

---

## Task 4: `runBrowseRefresh()` — populate the browse pool

**Files:**
- Create: `src/lib/job-board/browse-scrape.ts`
- Test: `src/lib/job-board/browse-scrape.test.ts`

**Interfaces:**
- Consumes: `browseAdapters()` (Task 3), `filterQualityJobs` (`job-quality.ts`), `resolveExpiry` (Task 2), `matchJobToClusters` (`cluster-matcher.ts`), `normalizeJobWorkMode` (`work-mode.ts`), `inferEmploymentType` (`employment-type.ts`), `prismaAdmin` (`@/lib/db`).
- Produces: `export async function runBrowseRefresh(options?: { now?: Date; adapters?: JobSourceAdapter[] }): Promise<{ upserted: number; expired: number; failedSources: number }>`. Injectable `adapters`/`now` for tests.

- [ ] **Step 1: Write the failing test (fake adapter + mocked prisma via DI)**

```ts
// src/lib/job-board/browse-scrape.test.ts
import assert from "node:assert/strict";
import { mock, test, beforeEach } from "node:test";
import type { JobSourceAdapter, NormalizedJob } from "./types";

// Mock the db module before importing the unit under test.
const upserts: unknown[] = [];
const expireCalls: unknown[] = [];
mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobBrowseListing: {
        upsert: async (args: unknown) => { upserts.push(args); return {}; },
        updateMany: async (args: unknown) => { expireCalls.push(args); return { count: 0 }; },
      },
    },
  },
});

const { runBrowseRefresh } = await import("./browse-scrape");

function fakeJob(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    title: "Customer Support Rep",
    company: "Acme",
    location: "Remote",
    workMode: "remote",
    salary: null,
    salaryMin: null,
    description: "Help customers over chat and email, resolve tickets, document issues.",
    url: "https://example.com/jobs/1",
    source: "remotive",
    sourceType: "api",
    sourceId: "remotive:1",
    postedAt: "2026-06-20T00:00:00Z",
    ...over,
  };
}

function fakeAdapter(jobs: NormalizedJob[]): JobSourceAdapter {
  return {
    source: "remotive",
    sourceType: "api",
    isConfigured: () => true,
    fetchJobs: async () => jobs,
  };
}

beforeEach(() => { upserts.length = 0; expireCalls.length = 0; });

test("runBrowseRefresh upserts quality jobs with computed expiresAt", async () => {
  const now = new Date("2026-06-25T00:00:00Z");
  const result = await runBrowseRefresh({ now, adapters: [fakeAdapter([fakeJob()])] });

  assert.equal(result.upserted, 1);
  assert.equal(upserts.length, 1);
  const arg = upserts[0] as { create: { expiresAt: Date; postedAt: Date; sourceId: string } };
  // postedAt 2026-06-20 + 45d
  assert.ok(arg.create.expiresAt instanceof Date);
  assert.equal(arg.create.postedAt.toISOString(), "2026-06-20T00:00:00.000Z");
});

test("runBrowseRefresh drops jobs that fail quality (e.g. missing company)", async () => {
  const now = new Date("2026-06-25T00:00:00Z");
  const result = await runBrowseRefresh({
    now,
    adapters: [fakeAdapter([fakeJob({ company: "" })])],
  });
  assert.equal(result.upserted, 0);
  assert.equal(upserts.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/browse-scrape.test.ts`
Expected: FAIL — cannot find module `./browse-scrape`.

- [ ] **Step 3: Write the implementation** (mirror `runScrapeForConfig` but config-free)

```ts
// src/lib/job-board/browse-scrape.ts
import { prismaAdmin as prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { matchJobToClusters } from "./cluster-matcher";
import { filterQualityJobs } from "./job-quality";
import { normalizeJobWorkMode } from "./work-mode";
import { inferEmploymentType } from "./employment-type";
import { resolveExpiry } from "./freshness";
import { browseAdapters } from "./browse-sources";
import type { JobSourceAdapter, NormalizedJob } from "./types";

interface RunBrowseRefreshOptions {
  now?: Date;
  adapters?: JobSourceAdapter[];
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fetch keyless sources and refresh the program-wide browse pool. */
export async function runBrowseRefresh(
  options: RunBrowseRefreshOptions = {},
): Promise<{ upserted: number; expired: number; failedSources: number }> {
  const now = options.now ?? new Date();
  const adapters = options.adapters ?? browseAdapters();
  const batchId = `browse:${now.getTime()}`;

  const settled = await Promise.allSettled(
    adapters.map((a) => a.fetchJobs("", 0)),
  );

  const allJobs: NormalizedJob[] = [];
  let failedSources = 0;
  for (const r of settled) {
    if (r.status === "fulfilled") allJobs.push(...r.value);
    else { failedSources++; logger.error("Browse adapter failed", { reason: String(r.reason) }); }
  }

  const normalized = allJobs.map((job) => ({
    ...job,
    workMode: normalizeJobWorkMode(job.workMode, job),
    employmentType: job.employmentType ?? inferEmploymentType(job),
  }));
  const quality = filterQualityJobs(normalized);

  let upserted = 0;
  for (const job of quality.jobs) {
    const postedAt = toDate(job.postedAt);
    const clusters = matchJobToClusters(job);
    await prisma.jobBrowseListing.upsert({
      where: { source_sourceId: { source: job.source, sourceId: job.sourceId } },
      create: {
        title: job.title, company: job.company, location: job.location,
        workMode: job.workMode, salary: job.salary, salaryMin: job.salaryMin,
        employmentType: job.employmentType, description: job.description, url: job.url,
        source: job.source, sourceType: job.sourceType, sourceId: job.sourceId,
        clusters, status: "active", postedAt, expiresAt: resolveExpiry(postedAt, now),
        scrapeBatchId: batchId,
      },
      update: {
        title: job.title, company: job.company, location: job.location,
        workMode: job.workMode, salary: job.salary, salaryMin: job.salaryMin,
        employmentType: job.employmentType, description: job.description,
        clusters, status: "active", postedAt, expiresAt: resolveExpiry(postedAt, now),
        scrapeBatchId: batchId, updatedAt: now,
      },
    });
    upserted++;
  }

  // Expire anything past its expiry (stale) — never hides unknown-date jobs
  // because resolveExpiry always set a concrete expiresAt at ingest.
  const expiredResult = await prisma.jobBrowseListing.updateMany({
    where: { status: "active", expiresAt: { lt: now } },
    data: { status: "expired" },
  });

  logger.info("Browse refresh complete", { upserted, failedSources, expired: expiredResult.count });
  return { upserted, expired: expiredResult.count, failedSources };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/browse-scrape.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the internal cron route + manual script**

Create `src/app/api/internal/jobs/browse-refresh/route.ts` mirroring an existing CRON_SECRET-guarded internal route (find one under `src/app/api/internal/`):

```ts
import { NextResponse } from "next/server";
import { runBrowseRefresh } from "@/lib/job-board/browse-scrape";
import { logger } from "@/lib/logger";

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runBrowseRefresh();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logger.error("browse-refresh failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Browse refresh failed" }, { status: 500 });
  }
}
```

Create `scripts/run-browse-refresh.mjs` mirroring an existing `scripts/run-*.mjs` (load env, dynamic-import the compiled job, log counts). **Operator step (noted, not run here):** register a daily Supabase pg_cron job hitting the internal route with `Authorization: Bearer $CRON_SECRET`, like the existing pg_cron jobs.

- [ ] **Step 6: Commit**

```bash
git add src/lib/job-board/browse-scrape.ts src/lib/job-board/browse-scrape.test.ts src/app/api/internal/jobs/browse-refresh/route.ts scripts/run-browse-refresh.mjs
git commit -m "feat(jobs): runBrowseRefresh populates program-wide browse pool from keyless sources"
```

---

## Task 5: Serve the browse pool from `GET /api/jobs` (always-numeric counts, decoupled personalization)

**Files:**
- Create: `src/lib/job-board/browse-jobs.ts`
- Test: `src/lib/job-board/browse-jobs.test.ts`
- Modify: `src/app/api/jobs/route.ts`

**Interfaces:**
- Consumes: `prisma.jobBrowseListing`, `parseJobFilters`/`buildJobFilterWhere` (`job-filters.ts`).
- Produces: `export async function loadBrowseJobs(params: { proximity: "local"|"remote"|"all"; sort: string; searchParams: URLSearchParams; limit?: number }): Promise<JobBrowseListing[]>` — active, non-expired, fresh, deduped browse jobs. Browse jobs are remote → they count as `totalRemote`.

- [ ] **Step 1: Write the failing test for `loadBrowseJobs`**

```ts
// src/lib/job-board/browse-jobs.test.ts
import assert from "node:assert/strict";
import { mock, test } from "node:test";

const queries: unknown[] = [];
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      jobBrowseListing: {
        findMany: async (args: unknown) => { queries.push(args); return []; },
      },
    },
  },
});

const { loadBrowseJobs } = await import("./browse-jobs");

test("loadBrowseJobs queries only active, non-expired listings", async () => {
  await loadBrowseJobs({ proximity: "all", sort: "recent", searchParams: new URLSearchParams() });
  const arg = queries[0] as { where: { status: string; expiresAt: { gt: Date } } };
  assert.equal(arg.where.status, "active");
  assert.ok(arg.where.expiresAt.gt instanceof Date);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/browse-jobs.test.ts`
Expected: FAIL — cannot find module `./browse-jobs`.

- [ ] **Step 3: Write `loadBrowseJobs`**

```ts
// src/lib/job-board/browse-jobs.ts
import { prisma } from "@/lib/db";
import { parseJobFilters, buildJobFilterWhere } from "./job-filters";

export async function loadBrowseJobs(params: {
  proximity: "local" | "remote" | "all";
  sort: string;
  searchParams: URLSearchParams;
  limit?: number;
}) {
  // Local tab never includes the (remote) browse pool.
  if (params.proximity === "local") return [];

  const now = new Date();
  const where: Record<string, unknown> = {
    status: "active",
    expiresAt: { gt: now },
  };
  Object.assign(where, buildJobFilterWhere(parseJobFilters(params.searchParams), now));

  return prisma.jobBrowseListing.findMany({
    where,
    orderBy: params.sort === "salary" ? { salaryMin: "desc" } : { postedAt: "desc" },
    take: params.limit ?? 100,
  });
}
```

> If `buildJobFilterWhere` references `createdAt` for the posted-within filter, add a `browse: true` branch (or a small mapping) so it filters `postedAt` for browse listings. Read `job-filters.ts` and adapt; keep `JobListing` behavior unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/browse-jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the browse fallback into `GET /api/jobs`**

Read `src/app/api/jobs/route.ts` (currently lines 32-196). Make these changes:
1. Replace the two bare early returns at `:48-50` and `:57-59` with a path that still returns the browse pool and **numeric counts**. Extract a helper `browseOnlyResponse(session, url)` that calls `loadBrowseJobs`, maps each browse row to the response job shape (same fields the UI consumes: `id, title, company, location, workMode, salary, salaryMin, employmentType, url, source, createdAt→postedAt, matchScore: 0, matchLabel: null`, `savedStatus: null`), and returns:

```ts
return NextResponse.json({
  jobs: browseJobs,
  hasDiscovery: false,
  hasResume: false,
  hasPersonalization: false,
  totalActive: browseJobs.length,
  totalLocal: 0,
  totalRemote: browseJobs.length,
  proximity: proximityFilter,
  totalSaved: 0,
});
```

   - When no enrollment OR no config → return `browseOnlyResponse` (jobs still show).
2. When a config DOES exist, after computing local `totalLocal/totalRemote`, **merge** browse-pool jobs into the Remote/All views (concatenate `loadBrowseJobs(...)`-mapped rows, dedupe by `source+sourceId`, recompute `totalRemote += browseRemoteCount`). Keep `totalLocal` from class jobs only.
3. Ensure the **success path already returns** `totalLocal/totalRemote` (it does, `:191-192`) — no change needed there beyond the merge.

- [ ] **Step 6: Manual verification (no live student needed — unit-level)**

Run the job-board suite:
`npx tsx --test --experimental-test-module-mocks $(git ls-files 'src/lib/job-board/**/*.test.ts')`
Expected: all pass. Then `npx eslint src/app/api/jobs/route.ts src/lib/job-board/browse-jobs.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/job-board/browse-jobs.ts src/lib/job-board/browse-jobs.test.ts src/app/api/jobs/route.ts
git commit -m "feat(jobs): serve browse pool from /api/jobs with always-numeric counts"
```

---

## Task 6: Fix the `NaN` count + default the proximity toggle to "all"

**Files:**
- Modify: `src/components/jobs/JobFilters.tsx:89-93`
- Modify: `src/components/career/CareerHub.tsx` (default `proximity` state; pass `?? 0` counts)

**Interfaces:**
- Produces: `JobFilters` renders `0` (never `NaN`) when counts are missing/non-finite.

- [ ] **Step 1: Harden `countFor` in `JobFilters.tsx`**

Replace the `countFor` body (`:89-93`):

```tsx
  const safeCount = (value: number): number => (Number.isFinite(value) ? value : 0);
  const countFor = (value: JobProximityFilter): number => {
    const local = safeCount(localCount);
    const remote = safeCount(remoteCount);
    if (value === "local") return local;
    if (value === "remote") return remote;
    return local + remote;
  };
```

- [ ] **Step 2: In `CareerHub.tsx`, default the proximity state to "all" and guard the props**

- Change the initial proximity state from `"local"` to `"all"` (so a student with only browse-pool jobs sees them on first load).
- Where `JobFilters` is rendered, pass `localCount={jobsData?.totalLocal ?? 0}` and `remoteCount={jobsData?.totalRemote ?? 0}`.

- [ ] **Step 3: Verify lint + typecheck**

Run: `npx eslint src/components/jobs/JobFilters.tsx src/components/career/CareerHub.tsx`
Expected: clean. (No `NaN` path: non-finite counts coerce to 0.)

- [ ] **Step 4: Commit**

```bash
git add src/components/jobs/JobFilters.tsx src/components/career/CareerHub.tsx
git commit -m "fix(jobs): guard filter counts against NaN; default proximity to All"
```

---

## Task 7: Clean job cards — posted date + source badge

**Files:**
- Modify: the job card render in `src/components/career/CareerHub.tsx` (or its `JobCard` child — locate by searching for where a job's `title`/`company` render).

**Interfaces:**
- Consumes: each job's `postedAt`/`createdAt` (ISO) and `source` from the `/api/jobs` response.

- [ ] **Step 1: Add a relative posted date + source badge to each card**

In the job card markup, add (matching existing Tailwind token classes used nearby):
- A muted "Posted {relative}" line using a small helper `formatPostedAt(iso: string | null): string` (e.g. "Posted 3 days ago"; "Posted recently" if null). Put the helper near the component or in an existing date util if one exists (search `src/lib` for `formatRelative`/`timeAgo` before adding a new one — DRY).
- A small source badge (e.g. `Remotive`, `Greenhouse`) using the existing badge/pill styles already used for the match label.

- [ ] **Step 2: Verify lint**

Run: `npx eslint src/components/career/CareerHub.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/career/CareerHub.tsx
git commit -m "feat(jobs): show posted date and source badge on job cards"
```

---

## Task 8: Kill the Career Discovery redirect loop

**Files:**
- Modify: `src/lib/sage/agent/tools.ts:302-306` (remove the `career-discovery` entry from `STATIC_RESOURCES`)
- Modify: `src/lib/sage/agent/tools.ts:333,343` (drop `career-discovery` from the `open_resource` description/argHint text)
- Test: `src/lib/sage/agent/tools.test.ts`

**Interfaces:**
- Produces: `open_resource("career-discovery")` now returns `status: "error"` (unknown resource) instead of an action card linking to `/career`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/sage/agent/tools.test.ts  (add to existing file if present; else create)
import assert from "node:assert/strict";
import test from "node:test";
import { agentTools } from "./tools"; // adjust to the actual export that exposes open_resource

function getOpenResource() {
  const tool = agentTools.find((t) => t.name === "open_resource");
  assert.ok(tool, "open_resource tool should exist");
  return tool;
}

test("open_resource no longer knows the self-referential career-discovery resource", async () => {
  const tool = getOpenResource();
  const result = await tool.execute({ resourceId: "career-discovery" });
  assert.equal(result.status, "error");
});

test("open_resource still resolves a real resource (goals)", async () => {
  const tool = getOpenResource();
  const result = await tool.execute({ resourceId: "goals" });
  assert.equal(result.status, "success");
  assert.equal(result.action?.target, "/goals");
});
```

> Adjust the import/export names to match the file (search `tools.ts` for how `open_resource` is exported — it may be inside an `AGENT_TOOLS` array or a registry). Keep the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/agent/tools.test.ts`
Expected: FAIL — `career-discovery` still resolves to success.

- [ ] **Step 3: Remove the `career-discovery` static resource**

In `src/lib/sage/agent/tools.ts`, delete the `"career-discovery": { ... }` entry (`:302-306`). Update the `open_resource` `description` (`:333`) and `argHint` (`:343`) strings to drop `career-discovery` from the enumerated list. (The tool's `enum` is `Object.keys(STATIC_RESOURCES)`, so it updates automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/agent/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the discovery system prompt (no self-referential "open")**

In `src/lib/sage/system-prompts.ts` (discovery-stage prompt, ~line 114-188 and the `open_resource` mention ~line 733), remove `career-discovery` from the list of openable resources so Sage is never told it can "open" the surface the student is already in.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sage/agent/tools.ts src/lib/sage/agent/tools.test.ts src/lib/sage/system-prompts.ts
git commit -m "fix(sage): remove self-referential career-discovery resource (kills redirect loop)"
```

---

## Final Phase 1 verification

- [ ] Run the full job-board + sage tool suites:
  `npx tsx --test --experimental-test-module-mocks $(git ls-files 'src/lib/job-board/**/*.test.ts' 'src/lib/sage/agent/*.test.ts')`
  Expected: all pass.
- [ ] `npx prisma validate` — valid.
- [ ] `npx eslint .` — clean (or no new errors in touched files).
- [ ] Manual smoke (optional, needs dev server + seeded browse pool): trigger `scripts/run-browse-refresh.mjs`, load `/career`, confirm Remote/All shows jobs, "All" shows a number (not `NaN`), cards show posted date + source, and starting a Sage discovery chat no longer renders an "Open Career Discovery" back-link.

---

## Self-Review (against the spec)

- **Spec §4.1 two-tier (browse):** Tasks 1,3,4,5 — ✅ browse pool + serve it.
- **Spec §4 decouple personalization:** Task 5 — ✅ jobs show with `hasPersonalization:false`.
- **Spec §5 C4 NaN + display + default toggle:** Tasks 6,7 — ✅.
- **Spec §7 anti-stale (setter before filter):** Tasks 2,4,5 — ✅ `resolveExpiry` sets `expiresAt` at ingest; `loadBrowseJobs` filters `expiresAt > now`; `isFresh` available; nothing filters a field that isn't set.
- **Spec §5 C1 loop fix:** Task 8 — ✅ (forward-action deferred to Phase 2, flagged).
- **Deferred to Phase 2 (not Phase 1):** profile assembler, local-tier teacher provisioning, CareerOneStop, `@@unique([source,sourceId,classConfigId])` (only matters for the class-scoped local tier), resume injection. None block Phase 1.
- **Placeholder scan:** none — every code step has real code; integration tasks (5,7,8) name exact files + lines and give the exact edits, with read-the-file notes only where a neighboring symbol name must be matched.
- **Type consistency:** `resolveExpiry`/`isFresh`/`MAX_JOB_AGE_DAYS`, `BROWSE_SOURCES`/`browseAdapters`, `runBrowseRefresh`, `loadBrowseJobs` names are used consistently across tasks.
