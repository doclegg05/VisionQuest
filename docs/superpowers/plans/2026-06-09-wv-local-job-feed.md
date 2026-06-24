# WV Local Job Feed + Student Filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface relevant, local, entry-level West Virginia jobs for SPOKES students by adding a CareerOneStop/National Labor Exchange source, making the board local-first, boosting verified local listings, and giving students the normal job-search filters.

**Architecture:** One new source adapter (`careeronestop`) plugs into the existing scrape → normalize → quality-filter → cluster-match → upsert → rank pipeline with no pipeline changes. A query-builder module (`spokes-job-queries`) targets the adapter at SPOKES entry-level titles. Ranking gains a small trusted-source boost. A new `employmentType` field + a pure `job-filters` helper power four student filters (keyword, date, min-pay, job-type).

**Tech Stack:** Next.js 16 (App Router), TypeScript (strict), Prisma 6 (PostgreSQL/Supabase, `visionquest` schema), node:test + `node:assert/strict` via `tsx`, Tailwind CSS 4, Phosphor icons.

**Spec:** `docs/superpowers/specs/2026-06-09-wv-local-job-feed-design.md`

**Test runner:** `npx tsx --test --experimental-test-module-mocks <file>` (single file) or `npm test` (suite). Lint: `npx eslint .`. Types: `npm run typecheck`.

---

## File Structure

```
src/lib/job-board/
  spokes-job-queries.ts            # CREATE — the relevance lever: titles the WV feed queries
  spokes-job-queries.test.ts       # CREATE
  adapters/careeronestop.ts        # CREATE — CareerOneStop/NLx adapter
  adapters/careeronestop.test.ts   # CREATE
  adapters/registry.ts             # MODIFY — register careeronestop
  source-options.ts                # MODIFY — add option + local-first DEFAULT_JOB_SOURCES
  source-options.test.ts           # MODIFY — assert local-first defaults
  recommendation.ts                # MODIFY — trusted-source boost
  recommendation.test.ts           # MODIFY — boost test
  employment-type.ts               # CREATE — inferEmploymentType()
  employment-type.test.ts          # CREATE
  job-filters.ts                   # CREATE — parse + build Prisma where for student filters
  job-filters.test.ts              # CREATE
  scrape-engine.ts                 # MODIFY — persist employmentType
  types.ts                         # MODIFY — NormalizedJob.employmentType, JobMatchReason "source"

prisma/schema.prisma               # MODIFY — JobListing.employmentType
src/app/api/jobs/route.ts          # MODIFY — apply student filters
src/components/jobs/JobFilters.tsx # MODIFY — keyword/date/pay/type controls
src/components/career/CareerHub.tsx# MODIFY — filter state + fetch params
.env.example                       # MODIFY — COS_USER_ID, COS_API_TOKEN
```

---

# PHASE 1 — Local supply (CareerOneStop / NLx)

## Task 1: SPOKES job query titles (the relevance lever)

**Files:**
- Create: `src/lib/job-board/spokes-job-queries.ts`
- Test: `src/lib/job-board/spokes-job-queries.test.ts`

> **Note for Britt (learning-mode):** `getSpokesJobQueryTitles()` decides which job titles the WV feed searches for — it literally determines what students see. The list below is a sensible default derived from your career clusters + a healthcare/trades supplement; tune it to your local labor market.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/job-board/spokes-job-queries.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSpokesJobQueryTitles } from "./spokes-job-queries";

describe("spokes job query titles", () => {
  it("includes the healthcare/trades supplement", () => {
    const titles = getSpokesJobQueryTitles();
    assert.ok(titles.includes("Certified Nursing Assistant"));
    assert.ok(titles.includes("CDL Driver"));
  });

  it("includes core SPOKES cluster titles", () => {
    const titles = getSpokesJobQueryTitles().map((t) => t.toLowerCase());
    assert.ok(titles.includes("administrative assistant"));
  });

  it("omits vague, non-searchable titles", () => {
    const titles = getSpokesJobQueryTitles().map((t) => t.toLowerCase());
    assert.ok(!titles.some((t) => t.includes("entry-level positions")));
  });

  it("dedupes case-insensitively and caps the list", () => {
    const titles = getSpokesJobQueryTitles();
    const lower = titles.map((t) => t.toLowerCase());
    assert.equal(new Set(lower).size, titles.length);
    assert.ok(titles.length <= 16);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/spokes-job-queries.test.ts`
Expected: FAIL — cannot find module `./spokes-job-queries`.

- [ ] **Step 3: Implement**

```typescript
// src/lib/job-board/spokes-job-queries.ts
import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";

/**
 * High-demand WV entry-level titles not yet covered by a formal career
 * cluster (there is no healthcare or skilled-trades cluster today). Querying
 * these makes those jobs appear; they match on location + skills even though
 * they earn no cluster-match points until the taxonomy expands.
 */
const HEALTHCARE_TRADES_TITLES = [
  "Certified Nursing Assistant",
  "Home Health Aide",
  "Caregiver",
  "Medical Assistant",
  "Warehouse Associate",
  "CDL Driver",
  "Maintenance Technician",
];

/** sampleJobs that make poor search keywords. */
const SKIP_TITLE_SUBSTRINGS = ["entry-level positions"];

const MAX_QUERY_TITLES = 16;

/**
 * Titles the CareerOneStop adapter queries against the class region.
 * THE RELEVANCE LEVER. Built from the first sample job of each SPOKES cluster
 * plus a healthcare/trades supplement; deduped (case-insensitive) and capped.
 */
export function getSpokesJobQueryTitles(): string[] {
  const clusterTitles = CAREER_CLUSTERS
    .map((cluster) => cluster.sampleJobs[0])
    .filter((title): title is string => Boolean(title));

  const seen = new Set<string>();
  const titles: string[] = [];

  for (const raw of [...HEALTHCARE_TRADES_TITLES, ...clusterTitles]) {
    const title = raw.trim();
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    if (SKIP_TITLE_SUBSTRINGS.some((bad) => key.includes(bad))) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= MAX_QUERY_TITLES) break;
  }

  return titles;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/spokes-job-queries.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/job-board/spokes-job-queries.ts src/lib/job-board/spokes-job-queries.test.ts
git commit -m "feat: add SPOKES job query titles for local feed targeting"
```

---

## Task 2: CareerOneStop adapter

**Files:**
- Create: `src/lib/job-board/adapters/careeronestop.ts`
- Test: `src/lib/job-board/adapters/careeronestop.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/job-board/adapters/careeronestop.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { careerOneStopAdapter } from "./careeronestop";

const ORIGINAL_FETCH = globalThis.fetch;

function mockJobsResponse(jobs: unknown[]): Response {
  return new Response(JSON.stringify({ Jobs: jobs }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("careeronestop adapter", () => {
  beforeEach(() => {
    process.env.COS_USER_ID = "test-user";
    process.env.COS_API_TOKEN = "test-token";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.COS_USER_ID;
    delete process.env.COS_API_TOKEN;
  });

  it("is not configured without env credentials", () => {
    delete process.env.COS_USER_ID;
    assert.equal(careerOneStopAdapter.isConfigured(), false);
  });

  it("returns [] when unconfigured", async () => {
    delete process.env.COS_API_TOKEN;
    assert.deepEqual(await careerOneStopAdapter.fetchJobs("Charleston, WV", 25), []);
  });

  it("maps CareerOneStop fields to NormalizedJob", async () => {
    globalThis.fetch = async () =>
      mockJobsResponse([
        {
          JvId: "abc1",
          JobTitle: "Administrative Assistant",
          Company: "Acme Co",
          Location: "Charleston, WV",
          URL: "https://example.com/job/abc1",
          Description: "Front desk and scheduling support for a busy office.",
        },
      ]);

    const jobs = await careerOneStopAdapter.fetchJobs("Charleston, WV", 25);
    const job = jobs.find((j) => j.sourceId === "careeronestop:abc1");
    assert.ok(job);
    assert.equal(job?.title, "Administrative Assistant");
    assert.equal(job?.company, "Acme Co");
    assert.equal(job?.source, "careeronestop");
    assert.equal(job?.sourceType, "api");
    assert.equal(job?.salary, null);
    assert.equal(job?.url, "https://example.com/job/abc1");
  });

  it("dedupes the same JvId returned across keyword queries", async () => {
    globalThis.fetch = async () =>
      mockJobsResponse([
        { JvId: "dup", JobTitle: "Caregiver", Company: "Home Care", Location: "Beckley, WV", URL: "https://example.com/dup", Description: "Assist clients with daily living tasks." },
      ]);
    const jobs = await careerOneStopAdapter.fetchJobs("WV", 25);
    assert.equal(jobs.filter((j) => j.sourceId === "careeronestop:dup").length, 1);
  });

  it("returns [] when the API errors", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.deepEqual(await careerOneStopAdapter.fetchJobs("WV", 25), []);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/adapters/careeronestop.test.ts`
Expected: FAIL — cannot find module `./careeronestop`.

- [ ] **Step 3: Implement**

```typescript
// src/lib/job-board/adapters/careeronestop.ts
import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, stripHtml, truncateDescription } from "./shared";
import { getSpokesJobQueryTitles } from "../spokes-job-queries";

/**
 * CareerOneStop "List Jobs" adapter — surfaces National Labor Exchange (NLx)
 * postings, which aggregate state job-bank listings (incl. WorkForce WV).
 * Requires COS_USER_ID and COS_API_TOKEN (free, royalty-free registration).
 * Returns [] when unconfigured.
 */
const COS_BASE = "https://api.careeronestop.org/v1/jobsearch";
const MAX_RESULTS = 60;
const PAGE_SIZE = 20;
const RECENCY_DAYS = 30;
const DEFAULT_RADIUS = 25;

interface CareerOneStopJob {
  JvId?: string;
  JobTitle?: string;
  Company?: string;
  Location?: string;
  URL?: string;
  Description?: string;
  DatePosted?: string;
}

interface CareerOneStopResponse {
  Jobs?: CareerOneStopJob[];
}

export const careerOneStopAdapter: JobSourceAdapter = {
  source: "careeronestop",
  sourceType: "api",

  isConfigured(): boolean {
    return Boolean(process.env.COS_USER_ID && process.env.COS_API_TOKEN);
  },

  async fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]> {
    const userId = process.env.COS_USER_ID;
    const token = process.env.COS_API_TOKEN;
    if (!userId || !token) return [];

    const location = region.trim() || "US";
    const radius = radiusMiles > 0 ? radiusMiles : DEFAULT_RADIUS;
    const seen = new Set<string>();
    const out: NormalizedJob[] = [];

    for (const keyword of getSpokesJobQueryTitles()) {
      if (out.length >= MAX_RESULTS) break;

      const path = [
        encodeURIComponent(userId),
        encodeURIComponent(keyword),
        encodeURIComponent(location),
        String(radius),
        "0", // sortColumns (relevance)
        "0", // sortOrder
        "0", // startRecord
        String(PAGE_SIZE),
        String(RECENCY_DAYS),
      ].join("/");

      const data = await fetchJson<CareerOneStopResponse>(
        `${COS_BASE}/${path}?source=NLx&showFilters=false`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      for (const job of data?.Jobs ?? []) {
        if (!job.JvId || !job.JobTitle || !job.URL) continue;
        const sourceId = `careeronestop:${job.JvId}`;
        if (seen.has(sourceId)) continue;
        seen.add(sourceId);

        const jobLocation = job.Location?.trim() || region;
        out.push({
          title: job.JobTitle,
          company: job.Company?.trim() || "Unknown",
          location: jobLocation,
          workMode: inferJobWorkMode({
            source: "careeronestop",
            title: job.JobTitle,
            company: job.Company,
            location: jobLocation,
            description: job.Description,
          }),
          salary: null,
          salaryMin: null,
          description: truncateDescription(stripHtml(job.Description)),
          url: job.URL,
          source: "careeronestop",
          sourceType: "api",
          sourceId,
        });

        if (out.length >= MAX_RESULTS) break;
      }
    }

    return out;
  },
};
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/adapters/careeronestop.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/job-board/adapters/careeronestop.ts src/lib/job-board/adapters/careeronestop.test.ts
git commit -m "feat: add CareerOneStop/NLx job source adapter"
```

---

## Task 3: Register adapter + local-first defaults + env docs

**Files:**
- Modify: `src/lib/job-board/adapters/registry.ts`
- Modify: `src/lib/job-board/source-options.ts`
- Modify: `src/lib/job-board/source-options.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update the source-options test (failing first)**

Add this test inside the `describe("job source options", ...)` block in `src/lib/job-board/source-options.test.ts`:

```typescript
  it("defaults to local-first sources including the WV feed", () => {
    assert.deepEqual(DEFAULT_JOB_SOURCES, ["careeronestop", "usajobs", "adzuna"]);
    for (const source of DEFAULT_JOB_SOURCES) {
      assert.equal(JOB_SOURCE_OPTIONS.find((o) => o.value === source)?.sourceMode, "local");
    }
  });
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/source-options.test.ts`
Expected: FAIL — `careeronestop` not in options; defaults still remote-tech.

- [ ] **Step 3: Add the option and change defaults in `source-options.ts`**

Replace the `DEFAULT_JOB_SOURCES` constant:

```typescript
export const DEFAULT_JOB_SOURCES = [
  "careeronestop",
  "usajobs",
  "adzuna",
] as const;
```

Add this entry to the top of the `JOB_SOURCE_OPTIONS` array (before `remotive`):

```typescript
  { value: "careeronestop", label: "WV Local Jobs — state job bank", sourceMode: "local" },
```

- [ ] **Step 4: Register the adapter in `registry.ts`**

Add the import (with the other adapter imports):

```typescript
import { careerOneStopAdapter } from "./careeronestop";
```

Add `careerOneStopAdapter` as the FIRST element of `ALL_JOB_SOURCE_ADAPTERS`:

```typescript
export const ALL_JOB_SOURCE_ADAPTERS: JobSourceAdapter[] = [
  careerOneStopAdapter,
  remotiveAdapter,
  // ...existing entries unchanged...
];
```

- [ ] **Step 5: Document the env var NAMES in `.env.example`**

Append (names only — never commit real values):

```bash
# CareerOneStop / National Labor Exchange (free, royalty-free). Register at
# https://www.careeronestop.org/Developers/WebAPI/registration.aspx
COS_USER_ID=
COS_API_TOKEN=
```

- [ ] **Step 6: Run tests + lint**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/source-options.test.ts`
Expected: PASS.
Run: `npx eslint src/lib/job-board/`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/job-board/registry.ts src/lib/job-board/source-options.ts src/lib/job-board/source-options.test.ts .env.example
git commit -m "feat: register CareerOneStop source and make defaults local-first"
```

> **Migration note for execution:** `DEFAULT_JOB_SOURCES` only affects NEW class configs. Existing classes must enable "WV Local Jobs" in the teacher source picker — it appears automatically via `source-health.ts`.

---

# PHASE 2 — Trusted-source ranking boost

## Task 4: Boost verified local sources

**Files:**
- Modify: `src/lib/job-board/types.ts`
- Modify: `src/lib/job-board/recommendation.ts`
- Modify: `src/lib/job-board/recommendation.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `recommendation.test.ts` (it already imports `scoreJob`; if not, add `import { scoreJob } from "./recommendation";`):

```typescript
describe("trusted-source boost", () => {
  it("ranks trusted local sources above generic local sources", () => {
    const discovery = { topClusters: ["finance-bookkeeping"], hollandCode: null };
    const region = "Charleston, WV";
    const generic = scoreJob(
      { id: "a", location: "Charleston, WV", clusters: ["office-admin"], source: "arbeitnow", workMode: "onsite" },
      discovery, region,
    );
    const trusted = scoreJob(
      { id: "b", location: "Charleston, WV", clusters: ["office-admin"], source: "careeronestop", workMode: "onsite" },
      discovery, region,
    );
    assert.ok(trusted.score > generic.score);
    assert.ok(trusted.matchReasons.some((r) => r.type === "source"));
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/recommendation.test.ts`
Expected: FAIL — scores equal / no `source` reason.

- [ ] **Step 3: Add `"source"` to the reason type union in `types.ts`**

```typescript
export type JobMatchReasonType =
  | "location"
  | "remote"
  | "cluster"
  | "riasec"
  | "skill"
  | "preference"
  | "feedback"
  | "source";
```

- [ ] **Step 4: Implement the boost in `recommendation.ts`**

Add constants near the other weights:

```typescript
const WEIGHT_SOURCE_TRUST = 5;
const TRUSTED_LOCAL_SOURCES = new Set(["careeronestop", "usajobs"]);
```

Add this helper (place it after `scoreInteractions`):

```typescript
function scoreSourceTrust(
  job: ScoredJob,
  classRegion: string,
): { score: number; reason: JobMatchReason | null } {
  if (!job.source || !TRUSTED_LOCAL_SOURCES.has(job.source)) return { score: 0, reason: null };
  if (classifyJobProximity(job, classRegion) !== "local") return { score: 0, reason: null };
  return {
    score: WEIGHT_SOURCE_TRUST,
    reason: { type: "source", label: "Verified local listing", value: job.source },
  };
}
```

In `scoreJob`, after the `const interactionScore = scoreInteractions(...)` line, add:

```typescript
  const trust = scoreSourceTrust(job, classRegion);
```

Update `totalScore` to include the trust score:

```typescript
  const totalScore = Math.max(
    0,
    Math.min(100, locationScore + clusterScore + riasecScore + skillScore + interactionScore.score + trust.score),
  );
```

Replace the `const matchReasons = buildMatchReasons({ ... });` result usage so the trust reason is included:

```typescript
  const baseReasons = buildMatchReasons({
    job,
    discovery,
    classRegion,
    clusterOverlap,
    skillOverlap,
    riasecScore,
    interactionReasons: interactionScore.reasons,
  });
  const matchReasons = trust.reason ? [trust.reason, ...baseReasons].slice(0, 6) : baseReasons;
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/recommendation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/job-board/types.ts src/lib/job-board/recommendation.ts src/lib/job-board/recommendation.test.ts
git commit -m "feat: boost verified local job sources in recommendation ranking"
```

---

# PHASE 3 — Job-type data

## Task 5: `employmentType` field + inference + persistence

**Files:**
- Create: `src/lib/job-board/employment-type.ts`
- Test: `src/lib/job-board/employment-type.test.ts`
- Modify: `src/lib/job-board/types.ts`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/job-board/scrape-engine.ts`

- [ ] **Step 1: Write the failing test for inference**

```typescript
// src/lib/job-board/employment-type.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferEmploymentType } from "./employment-type";

describe("inferEmploymentType", () => {
  it("detects part-time from title or description", () => {
    assert.equal(inferEmploymentType({ title: "Cashier (Part-Time)" }), "part_time");
    assert.equal(inferEmploymentType({ title: "Aide", description: "PRN / per diem shifts" }), "part_time");
  });
  it("detects full-time", () => {
    assert.equal(inferEmploymentType({ title: "Full-Time Warehouse Associate" }), "full_time");
  });
  it("returns null when unknown", () => {
    assert.equal(inferEmploymentType({ title: "Administrative Assistant", description: "Office support." }), null);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/employment-type.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement inference**

```typescript
// src/lib/job-board/employment-type.ts
export type EmploymentType = "full_time" | "part_time";

const PART_TIME_PATTERN = /\b(part[\s-]?time|prn|per[\s-]?diem)\b/i;
const FULL_TIME_PATTERN = /\b(full[\s-]?time)\b/i;

export function inferEmploymentType(input: {
  title?: string | null;
  description?: string | null;
}): EmploymentType | null {
  const text = [input.title, input.description].filter(Boolean).join(" ");
  if (PART_TIME_PATTERN.test(text)) return "part_time";
  if (FULL_TIME_PATTERN.test(text)) return "full_time";
  return null;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/employment-type.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the field to `NormalizedJob` in `types.ts`**

Add after the `salaryMin` line:

```typescript
  employmentType?: string | null;
```

- [ ] **Step 6: Add the column to `prisma/schema.prisma`**

In `model JobListing`, add after the `salaryMin Float?` line:

```prisma
  employmentType String?
```

- [ ] **Step 7: Validate + create migration**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid."
Run: `npx prisma migrate dev --name add_job_listing_employment_type`
Expected: migration created + applied; `npx prisma generate` runs.
Review the generated SQL — it must be a single `ALTER TABLE ... ADD COLUMN "employmentType"`; no DROP statements.

- [ ] **Step 8: Persist `employmentType` in `scrape-engine.ts`**

Add the import:

```typescript
import { inferEmploymentType } from "./employment-type";
```

Change the `normalizedJobs` map to infer employment type:

```typescript
    const normalizedJobs = allJobs.map((job) => ({
      ...job,
      workMode: normalizeJobWorkMode(job.workMode, job),
      employmentType: job.employmentType ?? inferEmploymentType(job),
    }));
```

In the `prisma.jobListing.upsert` call, add `employmentType: job.employmentType,` to BOTH the `create` and `update` objects (e.g. after the `salaryMin: job.salaryMin,` line in `create` and after `salaryMin: job.salaryMin,` in `update`).

- [ ] **Step 9: Verify build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint src/lib/job-board/`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/job-board/employment-type.ts src/lib/job-board/employment-type.test.ts src/lib/job-board/types.ts src/lib/job-board/scrape-engine.ts
git commit -m "feat: capture employmentType on job listings"
```

---

# PHASE 4 — Student filters

## Task 6: Filter parsing + Prisma where builder

**Files:**
- Create: `src/lib/job-board/job-filters.ts`
- Test: `src/lib/job-board/job-filters.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/job-board/job-filters.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJobFilters, buildJobFilterWhere } from "./job-filters";

describe("job filters", () => {
  it("parses and validates query params", () => {
    const params = new URLSearchParams({ q: "  nurse  ", postedWithinDays: "14", minPay: "15", jobType: "part_time" });
    assert.deepEqual(parseJobFilters(params), { q: "nurse", postedWithinDays: 14, minPay: 15, jobType: "part_time" });
  });

  it("rejects invalid values", () => {
    const params = new URLSearchParams({ postedWithinDays: "99", minPay: "-5", jobType: "contract" });
    assert.deepEqual(parseJobFilters(params), { q: "", postedWithinDays: null, minPay: null, jobType: null });
  });

  it("includes unknown-pay jobs when minPay is set", () => {
    const where = buildJobFilterWhere({ q: "", postedWithinDays: null, minPay: 15, jobType: null }, new Date("2026-06-09T00:00:00Z"));
    assert.deepEqual(where.AND, [{ OR: [{ salaryMin: { gte: 15 } }, { salaryMin: null }] }]);
  });

  it("filters by createdAt window and exact employmentType", () => {
    const now = new Date("2026-06-09T00:00:00Z");
    const where = buildJobFilterWhere({ q: "", postedWithinDays: 7, minPay: null, jobType: "full_time" }, now);
    assert.equal(where.employmentType, "full_time");
    assert.deepEqual(where.createdAt, { gte: new Date(now.getTime() - 7 * 86_400_000) });
  });

  it("returns an empty object when no filters are active", () => {
    assert.deepEqual(buildJobFilterWhere({ q: "", postedWithinDays: null, minPay: null, jobType: null }, new Date()), {});
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/job-filters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/job-board/job-filters.ts
import type { EmploymentType } from "./employment-type";

export interface JobFilterValues {
  q: string;
  postedWithinDays: number | null;
  minPay: number | null;
  jobType: EmploymentType | null;
}

const ALLOWED_DAYS = new Set([7, 14, 30]);
const DAY_MS = 86_400_000;

export function parseJobFilters(searchParams: URLSearchParams): JobFilterValues {
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);

  const daysNum = Number(searchParams.get("postedWithinDays"));
  const postedWithinDays = ALLOWED_DAYS.has(daysNum) ? daysNum : null;

  const payNum = Number(searchParams.get("minPay"));
  const minPay = Number.isFinite(payNum) && payNum > 0 ? payNum : null;

  const jobTypeRaw = searchParams.get("jobType");
  const jobType = jobTypeRaw === "full_time" || jobTypeRaw === "part_time" ? jobTypeRaw : null;

  return { q, postedWithinDays, minPay, jobType };
}

/**
 * Extra Prisma `where` clauses for JobListing. minPay deliberately keeps
 * unknown-pay jobs (salaryMin null) so missing data never hides a job.
 */
export function buildJobFilterWhere(filters: JobFilterValues, now: Date): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const and: unknown[] = [];

  if (filters.q) {
    and.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { company: { contains: filters.q, mode: "insensitive" } },
        { description: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }

  if (filters.minPay != null) {
    and.push({ OR: [{ salaryMin: { gte: filters.minPay } }, { salaryMin: null }] });
  }

  if (filters.postedWithinDays != null) {
    where.createdAt = { gte: new Date(now.getTime() - filters.postedWithinDays * DAY_MS) };
  }

  if (filters.jobType != null) {
    where.employmentType = filters.jobType;
  }

  if (and.length > 0) where.AND = and;

  return where;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/job-board/job-filters.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/job-board/job-filters.ts src/lib/job-board/job-filters.test.ts
git commit -m "feat: add student job filter parsing and where-builder"
```

---

## Task 7: Apply filters in the jobs API

**Files:**
- Modify: `src/app/api/jobs/route.ts`

- [ ] **Step 1: Import the filter helpers**

Add to the imports:

```typescript
import { parseJobFilters, buildJobFilterWhere } from "@/lib/job-board/job-filters";
```

- [ ] **Step 2: Parse filters and merge into the DB `where`**

After the existing `const where: Record<string, unknown> = { classConfigId: config.id, status: "active" };` block and its `cluster`/`workMode` additions (just before `const activeJobs = await prisma.jobListing.findMany({`), add:

```typescript
  const filters = parseJobFilters(url.searchParams);
  Object.assign(where, buildJobFilterWhere(filters, new Date()));
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint src/app/api/jobs/`
Expected: no errors.

- [ ] **Step 4: Manual smoke (optional, requires running app + seeded jobs)**

`GET /api/jobs?q=assistant&postedWithinDays=14&minPay=12&jobType=full_time` returns only matching jobs; jobs with `salaryMin: null` still appear when `minPay` is set.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/route.ts
git commit -m "feat: apply keyword/date/pay/type filters to jobs API"
```

---

## Task 8: Filter controls UI

**Files:**
- Modify: `src/components/jobs/JobFilters.tsx`
- Modify: `src/components/career/CareerHub.tsx`

- [ ] **Step 1: Extend `JobFilters.tsx` props + controls**

Add these options constants near the existing `SORT_OPTIONS`:

```typescript
const POSTED_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
];

const MIN_PAY_OPTIONS = [
  { value: "", label: "Any pay" },
  { value: "12", label: "$12+/hr" },
  { value: "15", label: "$15+/hr" },
  { value: "18", label: "$18+/hr" },
  { value: "20", label: "$20+/hr" },
];

const JOB_TYPE_OPTIONS = [
  { value: "", label: "Any type" },
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
];
```

Extend `JobFiltersProps`:

```typescript
  keyword: string;
  postedWithinDays: string;
  minPay: string;
  jobType: string;
  onKeywordChange: (value: string) => void;
  onPostedChange: (value: string) => void;
  onMinPayChange: (value: string) => void;
  onJobTypeChange: (value: string) => void;
```

Destructure them in the function signature, then add the controls inside the root `<div className="flex flex-wrap items-center gap-3">` (before the cluster `<select>`):

```tsx
      <label className="sr-only" htmlFor="job-keyword">Search jobs</label>
      <input
        id="job-keyword"
        type="search"
        value={keyword}
        onChange={(e) => onKeywordChange(e.target.value)}
        placeholder="Search title, company…"
        className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm min-w-44"
      />
      <label className="sr-only" htmlFor="job-posted">Date posted</label>
      <select id="job-posted" value={postedWithinDays} onChange={(e) => onPostedChange(e.target.value)}
        className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm">
        {POSTED_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <label className="sr-only" htmlFor="job-pay">Minimum pay</label>
      <select id="job-pay" value={minPay} onChange={(e) => onMinPayChange(e.target.value)}
        className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm">
        {MIN_PAY_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <label className="sr-only" htmlFor="job-type">Job type</label>
      <select id="job-type" value={jobType} onChange={(e) => onJobTypeChange(e.target.value)}
        className="rounded-lg bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border)] px-3 py-2 text-sm">
        {JOB_TYPE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
```

- [ ] **Step 2: Wire state + debounced keyword into `CareerHub.tsx`**

Add state after the existing `const [sort, setSort] = useState("recommended");`:

```typescript
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [postedWithinDays, setPostedWithinDays] = useState("");
  const [minPay, setMinPay] = useState("");
  const [jobType, setJobType] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(handle);
  }, [keyword]);
```

In the data-fetch `useEffect`, add the new params after `if (sort) params.set("sort", sort);`:

```typescript
      if (debouncedKeyword.trim()) params.set("q", debouncedKeyword.trim());
      if (postedWithinDays) params.set("postedWithinDays", postedWithinDays);
      if (minPay) params.set("minPay", minPay);
      if (jobType) params.set("jobType", jobType);
```

And extend that effect's dependency array:

```typescript
  }, [cluster, proximity, sort, debouncedKeyword, postedWithinDays, minPay, jobType, refreshKey]);
```

Pass the new props to `<JobFilters ... />`:

```tsx
                keyword={keyword}
                postedWithinDays={postedWithinDays}
                minPay={minPay}
                jobType={jobType}
                onKeywordChange={setKeyword}
                onPostedChange={setPostedWithinDays}
                onMinPayChange={setMinPay}
                onJobTypeChange={setJobType}
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint src/components/jobs/ src/components/career/`
Expected: no errors.

- [ ] **Step 4: Manual verification (running app)**

On `/career#jobs`: typing in the search box filters after ~300ms; the date/pay/type selects refine results; clearing returns to the full list. Confirm keyboard focus + screen-reader labels on each control.

- [ ] **Step 5: Commit**

```bash
git add src/components/jobs/JobFilters.tsx src/components/career/CareerHub.tsx
git commit -m "feat: add keyword/date/pay/type job filter controls"
```

---

## Final verification

- [ ] Run the full suite: `npm test` — all green.
- [ ] Lint the repo: `npx eslint .` — no errors.
- [ ] Types: `npm run typecheck` — no errors.
- [ ] Prisma: `npx prisma validate` — valid.

---

## Self-review notes (spec coverage)

- §5.1 careeronestop adapter → Task 2. §5.2 spokes-job-queries (+healthcare/trades) → Task 1. §5.3 registration + local-first defaults + teacher visibility → Task 3 (visibility is automatic via existing `source-health.ts`). §5.4 trusted-source boost → Task 4. §5.5 employmentType field + inference + persistence → Task 5. §5.6 student filters (API + UI) → Tasks 6–8. §7 secrets (names only) → Task 3 Step 5. §8 testing → tests in every logic task; UI verified via typecheck/lint/manual (no component-test harness in repo).
- Deferred per spec (not in this plan): cluster-taxonomy expansion, teacher employer roster via `companyName`, O*NET-code keyword mapping, funnel analytics.
- Type consistency: `EmploymentType` defined in `employment-type.ts` and reused in `job-filters.ts`; `getSpokesJobQueryTitles` consumed by `careeronestop.ts`; `"source"` reason type added in `types.ts` and produced in `recommendation.ts`, rendered by `JobCard` via `reason.label` (no exhaustive switch — safe).
