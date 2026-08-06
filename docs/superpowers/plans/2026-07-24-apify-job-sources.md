# Apify Job Sources — Pilot Findings + Implementation Plan

> **Status:** Plan. Pilot scrape executed 2026-07-24; findings below are measured, not estimated.
> **For agentic workers:** Phases 1–3 are implementable via `superpowers:executing-plans`. Read the Findings section first — Finding 4 is a product decision that should be resolved before Phase 1 ships.

**Goal:** Close the local-supply gap in the job board by adding Indeed (and optionally Google Jobs) as Apify-backed source adapters, and use the pilot data to correct two defects the pilot exposed in cluster matching and location scoring.

**Why now:** `careeronestop` is the only true local feed. The other nine keyless adapters are remote/ATS and tech-skewed — near-irrelevant for TANF/SNAP adults in WV. Indeed and Google Jobs carry the bulk of WV hourly postings and have no public API.

---

## Pilot Method

Actor `kaix/indeed-scraper` (PPE: $0.00005/job, $0.00001/start), 12 runs on 2026-07-24:

- **Titles:** the exact 13 returned by `getSpokesJobQueryTitles()`, split into two Indeed advanced-syntax queries — `title:("A" or "B" or …)`. Group A = the 7 `HEALTHCARE_TRADES_TITLES`; Group B = the 6 cluster `sampleJobs[0]` entries.
- **Locations:** Charleston, Huntington, Beckley, Parkersburg, Morgantown, Martinsburg WV
- **Filters:** `radius=25` miles, `fromDays=7`, `sort=date`, `maxItems=200`, `searchMode=basic`

Grouping titles with `or` collapsed 78 title×metro runs into 12 with no loss of coverage.

---

## Findings

### 1. Actual volume is ~3% of the modeled ceiling — cost is a non-issue

| Metro | Group A (health/trades) | Group B (office/service) |
|---|---:|---:|
| Charleston | 26 | 5 |
| Huntington | 15 | 3 |
| Beckley | 18 | 1 |
| Parkersburg | 14 | 7 |
| Morgantown | 18 | 8 |
| Martinsburg | 36 | 7 |
| **Total** | **127** | **31** |

**158 jobs statewide for a full week.** The pre-pilot model assumed the 50-per-title-per-metro cap would bind (4,800 jobs, ~$0.24/run). It does not come close.

Measured cost of the entire pilot: **158 × $0.00005 + 12 starts ≈ $0.008.** Under one cent.

**Consequence:** the weekly-cadence assumption is wrong in the cheap direction. A **daily** scrape costs roughly **$0.24/month** and gives students same-week postings instead of up-to-seven-days-stale ones. Recommend daily.

### 2. Out-of-state bleed is severe at the state's edges

`radius=25` from an edge metro returns mostly out-of-state jobs:

| Metro | Non-WV share of Group A | Bleeds into |
|---|---:|---|
| Martinsburg | ~86% (31/36) | Hagerstown MD, Winchester VA, Greencastle/Mercersburg PA |
| Morgantown | 50% (9/18) | Uniontown, Waynesburg, Lemont Furnace PA |
| Parkersburg | 50% (7/14) | Marietta, Belpre OH |
| Huntington | ~27% (4/15) | Ashland KY, South Point OH |

Huntington's bleed is **legitimate** — the tri-state area genuinely commutes. Martinsburg's is not: a Martinsburg student would open the board and see a Maryland job board.

This is not purely an Apify problem — CareerOneStop has the same geography — but Apify's volume makes it visible. `localJobPriority: "prefer_local"` scores on location match; it needs to be distance-aware or state-aware, not string-match-aware.

### 3. Intra-source duplication is heavy and defeats `sourceId` uniqueness

Every near-duplicate carries a **distinct Indeed job key**, so the `@unique sourceId` constraint will not collapse them:

- Beckley: `Caregiver / REM Community Services / Beckley WV 25801 / $14.75` — **5 rows**
- Beckley: `Clinic Medical Assistant / Appalachian Regional Healthcare` — **6 rows**, varying only by title case (`MEDICAL ASSISTANT` vs `Medical Assistant`) and ZIP presence (`Beckley, WV 25801` vs `Beckley, WV`)
- Parkersburg: `Certified Nursing Assistant, CNA / Willows Center - WV` — 2 identical rows
- Martinsburg: Ryder posts `Warehouse Maintenance Technician`, `Maintenance Technician Warehouse 1st Shift`, and `Warehouse Maintenance Technician 1st Shift` — 3 near-dupes, all $30/hr Hagerstown

**Roughly 25–30% of Group A is duplicate.** `duplicates.ts` must run on this feed with case-normalized title + company + ZIP-stripped city. Without it, a Beckley student's board is one employer repeated.

### 4. The cluster taxonomy is inverted relative to the WV labor market

This is the most important finding and it is a **product** finding, not a scraping one.

- The 7 `HEALTHCARE_TRADES_TITLES` — which belong to **no career cluster** and therefore earn **zero cluster-match points** in `recommendation.ts` — produced **127 of 158 jobs (80%)**.
- The 6 titles drawn from actual `CAREER_CLUSTERS` produced **31 (20%)**.
- **Graphic Designer: 0 statewide.** **Help Desk Technician: 1** (Marietta OH, $25.66/hr, mid-level — not an entry-level SPOKES target).
- Beckley returned exactly **one** office/service job for the entire week.

The comment in `spokes-job-queries.ts` already anticipates this: *"there is no healthcare or skilled-trades cluster today… they match on location + skills even though they earn no cluster-match points until the taxonomy expands."* The pilot quantifies it — the scoring model actively down-ranks the 80% of the market that students can actually be hired into.

Adding Indeed without addressing this makes the symptom worse: more healthcare/trades supply flowing into a matcher that scores it at zero.

### 5. Indeed carries two fields CareerOneStop does not

- **`requirements.experienceLevel`** — `Entry level` / `Mid-level` / `Senior level` / `1 year` / `2 years`. ~65% of Group A is `Entry level`. This is directly usable as a hard relevance filter and is a better SPOKES signal than anything currently in `JobListing`.
- **`salary.text`** present on ~55% of rows, with a coherent band: $13–18/hr caregiving and CNA, $18–23 warehouse and maintenance, $28–33 CDL.

Two parser hazards observed: `"From $24 a year"` (a mis-tagged hourly rate) and `"$23 - $27 per point"` (BAYADA per-visit pay). `salary-parser.ts` must reject implausible annual values and unrecognized period units rather than coercing them.

---

## Plan

### Phase 1 — `apify-indeed` adapter

- `src/lib/job-board/adapters/apify-indeed.ts` implementing the existing `JobSourceAdapter` interface. No pipeline changes: normalize → `job-quality` → `cluster-matcher` → upsert, same path as `careeronestop`.
- Call Apify `run-sync-get-dataset-items`. Scrape runs already go through the background queue (`src/lib/jobs.ts`), so an ~85s Actor run is within budget. Observed pilot runtime: 82s.
- Build queries with `getSpokesJobQueryTitles()` grouped into `title:(… or …)` batches — do not issue one run per title.
- `sourceId` scheme: `apify-indeed:{indeedJobKey}`.
- Map `requirements.experienceLevel` → a new nullable `JobListing.experienceLevel`.
- Register in `adapters/registry.ts`; add to `JOB_SOURCE_OPTIONS` with `sourceMode: "local"`.
- New env: `APIFY_TOKEN`. Add to `.env.example` and Render.
- Set `maxTotalChargeUsd` on every call so a runaway cannot drain the account.

### Phase 2 — fix what the pilot exposed

Ordered by how badly each degrades the student's board:

1. **Dedupe** (Finding 3) — extend `duplicates.ts` to case-normalize titles and strip ZIP from city before comparison. Highest visible impact.
2. **Geography** (Finding 2) — make `prefer_local` distance-aware. Keep Huntington's legitimate tri-state bleed; suppress Martinsburg's Maryland flood. Consider a per-class `allowedStates` on `JobClassConfig`.
3. **Salary guards** (Finding 5) — reject implausible annual values and unknown period units in `salary-parser.ts`.
4. **Experience filter** — expose `experienceLevel` as a student filter alongside the existing keyword/date/pay/type set.

### Phase 3 — cluster taxonomy (needs an owner decision)

Finding 4 is not an engineering task. The options:

- **(a)** Add healthcare and skilled-trades clusters to `CAREER_CLUSTERS`, so the 80% of the market that exists earns match points. Largest change; touches orientation, pathways, and `estimatedWeeks`.
- **(b)** Leave the taxonomy and add a location+experience relevance channel that can outrank cluster match, so unclustered entry-level local jobs still surface.
- **(c)** Accept the current state and document that the board intentionally favors cluster-aligned work over available work.

Recommend **(a)**, but it is a program decision with curriculum implications, not a code cleanup. It belongs in `PRODUCT_DECISIONS.md` before Phase 1 ships, because Phase 1 increases the volume of zero-scored supply.

### Deferred

- **Google Jobs** (`gio21/google-jobs-scraper`, $0.003/job) — at 158 jobs/week the coverage-audit case is weak; revisit only if Indeed coverage looks incomplete against a known-good employer list.
- **WV employer directory** (Google Maps, ~$6/quarter) — work-based-learning partner list plus a verified-local-employer boost.
- **RAG corpus refresh** (`apify/website-content-crawler`, free) — WorkForce WV, DHHR TANF/SNAP policy, WVCTCS credential pages → `ProgramDocument`. Independent of the job board; can proceed in parallel.

---

## Constraints

- **FERPA:** all three scrapes read public external data. No student data leaves the process, so the `resolveAiProvider` local-only routing for `student_record` / `staff_entered` is untouched. Stated here so it does not have to be re-derived at review.
- **Indeed ToS:** the Actor is Store-published and Apify treats Store Actors as compliant, but VisionQuest is a program-facing product with a state relationship behind it. This is an owner call, not an engineering default. Google Jobs + CareerOneStop is the more conservative pairing if the answer is no.
- **Cost:** measured at well under $0.01 per full statewide run. Apify's free tier ($5/month credit) covers a daily cadence with room to spare.
