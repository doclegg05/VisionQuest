# Design: Curated WV Local Job Feed + Student Job Filters

**Date:** 2026-06-09
**Status:** Draft — awaiting user review
**Area:** Job Search (`src/lib/job-board/`, `src/components/jobs/`, `src/components/career/`)
**Related:** `docs/superpowers/plans/2026-03-31-job-board.md` (original board), memory `project_alpha_stage` (no live students yet)

---

## 1. Problem

The job-matching engine ([`recommendation.ts`](../../../src/lib/job-board/recommendation.ts)) is strong and local-aware (location/cluster/RIASEC/skills/interaction scoring, `classifyJobProximity`, `prefer_local` policy). The weakness is **supply, not ranking**: the default sources skew remote/tech and don't surface the local, entry-level West Virginia jobs SPOKES students (TANF/SNAP adults, often low-literacy, frequently without reliable transportation) actually need.

Concretely:

- `DEFAULT_JOB_SOURCES = ["remotive", "remoteok", "weworkremotely", "jsearch"]` — three are remote-only tech boards; `jsearch` needs a paid RapidAPI key.
- The no-key ATS adapters (`greenhouse`, `lever`, `ashby`, `smartrecruiters`) hardcode elite tech employers (Airbnb, Anthropic, Stripe, OpenAI…) → software-engineer roles.
- The local-capable adapters (`adzuna`, `usajobs`, `jsearch`) query only `where=region` — a generic dump with no targeting toward SPOKES job titles, and none is a default that reliably represents the WV public job market.
- Students also lack the **normal job-search filters** (keyword, date posted, pay, job type) they'd expect.

**A "Ferrari engine on an empty tank": fix the fuel (local supply) and give students the dashboard controls (filters).**

## 2. Goal

1. Add an authoritative **West Virginia local job feed** sourced from the **National Labor Exchange (NLx)** via the **CareerOneStop "List Jobs" Web API**, targeted at SPOKES entry-level job titles and the class's region.
2. Make the board **local-first by default** and rank curated WV jobs above generic local results.
3. Give students the **normal filters**: keyword search, date posted, minimum pay, and job type.

Non-goals: redesigning the matching algorithm; merging the scraped board with the curated Opportunity board; building a teacher "trusted employer roster" (kept as a future layer the chosen API already supports via its `companyName` param).

## 3. Verified external API (research complete)

**CareerOneStop List Jobs API** — confirmed against the official developer site and multiple live client implementations on GitHub.

- **Endpoint:** use **v1** (proven across every live client we checked): `https://api.careeronestop.org/v1/jobsearch/{userId}/{keyword}/{location}/{radius}/{sortColumns}/{sortOrder}/{startRecord}/{pageSize}/{days}?source=NLx&showFilters=false`. `v2` is identical plus `enableJobDescriptionSnippet`/`enableMetaData` flags — adopt only if we want richer description snippets.
- **Auth:** `Authorization: Bearer {token}` header + `userId` in the path. **Two free credentials** (`COS_USER_ID`, `COS_API_TOKEN`). Royalty-free license, renews every 36 months.
- **Params:** `keyword` (plain text or O*NET code), `location` (city / state / ZIP), `radius` (miles), `days` (recency window; `0` = all), sort/order/pagination.
- **Response:** `{ "Jobs": [ { "JvId", "JobTitle", "Company", "Location", "URL", "Description", "DatePosted" } ] }` → maps cleanly to `NormalizedJob`. Salary is typically absent in NLx data (acceptable — adapters already handle null salary).
- **Privacy/FERPA:** outbound requests carry only keyword + region. **No student PII leaves the system.**

Sources: CareerOneStop List Jobs V2 docs; NASWA/NLx Research Hub; live clients (`dtressel/Jobalyze`, `CeylinBrooks/RegearCareer`, `codeforamerica/job-commute-search`).

## 4. Architecture

One new adapter; **no new pipeline**. It reuses the existing scrape → normalize → quality-filter → cluster-match → upsert → rank flow.

```
scrape-engine (per JobClassConfig)
  └─ careeronestopAdapter.fetchJobs(region, radius)        ← NEW (sourceMode: "local")
        └─ for each SPOKES target title: GET CareerOneStop (region, radius, recent)
        └─ normalize → filterQualityJobs → matchJobToClusters → upsert JobListing(source="careeronestop")

/api/jobs?cluster&proximity&sort&q&postedWithinDays&minPay&jobType   ← filters EXTENDED
  └─ rankJobs(prefer_local) + trusted-source boost
  └─ careeronestop jobs classify as "local" → surface on top
        └─ CareerHub → JobFilters (extended UI) → JobList
```

## 5. Components

### 5.1 `careeronestopAdapter` — `src/lib/job-board/adapters/careeronestop.ts` (NEW)
- **Purpose:** fetch NLx job postings for the class region, targeted at SPOKES titles.
- **Interface:** implements `JobSourceAdapter` (`source: "careeronestop"`, `sourceType: "api"`, `sourceMode` declared in `source-options`).
  - `isConfigured()` → `!!process.env.COS_USER_ID && !!process.env.COS_API_TOKEN`.
  - `fetchJobs(region, radiusMiles)` → for each target title (from `spokes-job-queries`), GET the endpoint (`days=30`, sort by acquisition date desc, small `pageSize`), Bearer auth; normalize each `Job` → `NormalizedJob` (`sourceId: `careeronestop:{JvId}``, `salary: null`, `workMode: inferJobWorkMode(...)`, description via `stripHtml`/`truncateDescription`). Dedupe by `JvId` within the call; cap at 60 total; per-title try/catch isolates failures; any error → `[]` (graceful, matches existing adapters).
- **Depends on:** `shared.ts` (`fetchJson`, `stripHtml`, `truncateDescription`), `work-mode.ts`, `spokes-job-queries.ts`, env vars.

### 5.2 `spokes-job-queries` — `src/lib/job-board/spokes-job-queries.ts` (NEW)
- **Purpose:** the relevance lever. Produce the curated list of entry-level job titles to query, so it's testable and tunable in one place.
- **Interface:** `getSpokesJobQueryTitles(): string[]`.
- **Content:** a deduped subset of `CAREER_CLUSTERS[].sampleJobs` **plus a healthcare/trades supplement** (e.g. *Certified Nursing Assistant, Caregiver, Home Health Aide, CDL Driver, Warehouse Associate*) — high-demand WV paths not yet in the cluster taxonomy. Capped (~10–12 titles) to bound API calls.
- **Note:** healthcare/trades jobs will surface but won't earn cluster-match points until the taxonomy formally adds those clusters (out of scope here — see `career-clusters.ts`). They still score on location + skills.

### 5.3 Source registration & local-first defaults
- `registry.ts`: add `careeronestopAdapter` to `ALL_JOB_SOURCE_ADAPTERS`.
- `source-options.ts`: add `{ value: "careeronestop", label: "WV Local Jobs — state job bank", sourceMode: "local" }`. **Change** `DEFAULT_JOB_SOURCES` to the local trio: `["careeronestop", "usajobs", "adzuna"]`. Remote boards become opt-in.
- **Migration note:** `DEFAULT_JOB_SOURCES` only affects **new** `JobClassConfig` rows. Existing classes keep their stored `sources` and must enable careeronestop in the teacher UI. The teacher config + `source-health` already surface configured/selected state; we add a one-line nudge when no `local`-mode source is selected.

### 5.4 Trusted-source ranking boost — `recommendation.ts` (EXTEND)
- Add `WEIGHT_SOURCE_TRUST` (small, ~5) applied when a job's `source` ∈ `TRUSTED_LOCAL_SOURCES` (`["careeronestop", "usajobs"]`) **and** its proximity is `local`. Folded into the existing `Math.min(100, …)` cap so curated WV jobs edge out generic local results without distorting the scale. Surfaced as a `matchReason` ("Verified WV listing").

### 5.5 Job-type data — `prisma/schema.prisma` + adapters (EXTEND)
- Add `employmentType String?` to `JobListing` (`@@schema("visionquest")`; descriptive migration `add_job_listing_employment_type`).
- Add `employmentType?: string | null` to `NormalizedJob`; a shared `inferEmploymentType()` (in `work-mode.ts` or a sibling) parses "part-time"/"full-time" from title/description; adapters that expose it (Adzuna `contract_time`, etc.) pass it through. Persist on upsert.

### 5.6 Student filters — `/api/jobs` + `JobFilters.tsx` + `CareerHub.tsx` (EXTEND)
- **API:** add query params `q` (keyword), `postedWithinDays` (7|14|30), `minPay` (number, hourly), `jobType` (`full_time`|`part_time`). Applied to the stored-listing query/filter:
  - `q` → case-insensitive match on title/company/description.
  - `postedWithinDays` → `createdAt >= now - N days`.
  - `minPay` → `salaryMin >= minPay` **OR `salaryMin == null`** (include unknown-pay; never hide jobs for missing data).
  - `jobType` → `employmentType == jobType` (best-effort; unknown-type jobs are excluded only when a specific type is chosen; default "Any type"; UI notes some listings lack type data).
- **UI (`JobFilters.tsx`):** add a debounced keyword box (wire the existing `MagnifyingGlass` icon), a "Posted" select, a "Min pay" select, and a "Job type" select. Keep the low-literacy, large-touch-target style; all controls labeled for screen readers (WCAG AA per `.claude/rules/ui-patterns.md`).
- **`CareerHub.tsx`:** add the new filter state to the existing `useEffect` fetch params; keep debouncing for `q`.

## 6. Error handling
- Adapter: per-title try/catch → log via `logger` + continue; whole-adapter failure → `[]`. Never throws into the pipeline (consistent with all adapters).
- API: invalid/garbage filter values are ignored (fall back to defaults), never 500. No raw Prisma errors to the client (per `.claude/rules/api-conventions.md`).

## 7. Security & privacy
- New secrets are **names only**: `COS_USER_ID`, `COS_API_TOKEN`. Document in `.env.example` / `DEPLOY.md`; set in `.env.local` (dev) and Render (prod). **Never committed.** Adapter returns `[]` when unset.
- No student PII in outbound API calls (region + keyword only). FERPA-safe.
- Reuses existing auth (`withAuth`) on `/api/jobs`; no new authz surface.

## 8. Testing (TDD; ≥80% per `.claude/rules/testing.md`)
- `careeronestop.test.ts`: mocked `fetchJson` → field mapping, `sourceId`, null salary, dedupe, 60-cap, per-title error isolation, `isConfigured` gating (env present/absent), empty when unconfigured.
- `spokes-job-queries.test.ts`: dedupe, cap, includes healthcare/trades supplement.
- `recommendation.test.ts` (extend): trusted-source boost applied only for trusted local sources at local proximity; 100-cap respected; reason surfaced.
- `work-mode`/employment-type parsing tests; salary-null filter behavior.
- API filter tests: `q`, `postedWithinDays`, `minPay` (include-null), `jobType` (exclude-unknown when set).
- Run `npx prisma validate` after schema edit; `npx eslint .` before commit.

## 9. Scope

**In scope:** careeronestop adapter; `spokes-job-queries` (incl. healthcare/trades terms); registry + local-first defaults + teacher nudge; trusted-source boost; `employmentType` field + parsing; student filters (keyword, date, min-pay, job-type) API + UI; tests; env-var docs.

**Out of scope (deferred):** cluster-taxonomy expansion (healthcare/trades as formal clusters); teacher "trusted employer roster" via `companyName`; O*NET-code keyword mapping; merging the curated Opportunity board; effectiveness/funnel analytics.

## 10. Suggested phasing (for the implementation plan)
1. **Supply:** `careeronestop` adapter + `spokes-job-queries` + registry/defaults + tests. *(Ships dark until token added.)*
2. **Ranking:** trusted-source boost + reason.
3. **Data:** `employmentType` schema/migration + adapter parsing.
4. **Filters:** API params + `JobFilters`/`CareerHub` UI + tests.

Each phase is independently shippable and leaves the board working.

## 11. Risks & open questions
- **NLx coverage density in rural WV** is unknown until the token is live — measurable then; the local-first default + targeted titles are our mitigations.
- **Job-type data is sparse** across sources; the filter is best-effort and labeled as such.
- **Query volume:** ~10–12 titles × per-class scrape. Keep `pageSize` small and the 60-cap; revisit if CareerOneStop rate limits bite.
- Confirm `inferJobWorkMode` treats CareerOneStop locations sensibly (most are onsite/local).
