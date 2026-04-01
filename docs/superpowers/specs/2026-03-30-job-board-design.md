# Job Board Feature — Design Spec

**Date:** 2026-03-30
**Status:** Approved
**Author:** Claude (brainstorming session with instructor)

## Overview

Automated job board for VisionQuest that scrapes and aggregates local job listings weekly, matches them to students' SPOKES career profiles, and displays them on a dashboard widget and dedicated `/jobs` page. Instructors configure their class's region and sources; students save, track, and get personalized recommendations.

## Data Model

### JobListing

Stores each job from any source (scraped or API). Replaces nothing — new model alongside existing `Opportunity`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String @id @default(cuid()) | PK |
| `title` | String | Job title |
| `company` | String | Employer name |
| `location` | String | City/county, state |
| `salary` | String? | Raw salary text (e.g., "$14/hr", "$30,000/year") |
| `salaryMin` | Float? | Parsed minimum hourly rate (normalized) |
| `description` | String @db.Text | Job description |
| `url` | String | Link to original posting |
| `source` | String | "indeed", "ziprecruiter", "workforcewv", "usajobs", "adzuna", "jsearch" |
| `sourceType` | String | "scrape" or "api" |
| `sourceId` | String @unique | Dedup key — URL hash for scraped, posting ID for API |
| `clusters` | String[] @default([]) | Matched SPOKES career clusters |
| `status` | String @default("active") | "active" or "expired" |
| `expiresAt` | DateTime? | When the posting expires |
| `scrapeBatchId` | String | Links to the scrape run that found it |
| `classConfigId` | String | FK to JobClassConfig |
| `createdAt` | DateTime @default(now()) | |
| `updatedAt` | DateTime @updatedAt | |

Indexes: `@@index([classConfigId, status])`, `@@index([status, createdAt])`

### JobClassConfig

Per-class scraping configuration set by instructors.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String @id @default(cuid()) | PK |
| `classId` | String @unique | FK to SpokesClass |
| `region` | String | Search area (e.g., "Charleston, WV") |
| `radius` | Int @default(25) | Search radius in miles |
| `sources` | String[] @default(["indeed", "workforcewv"]) | Which sources to use |
| `autoRefresh` | Boolean @default(true) | Monday auto-refresh enabled |
| `lastScrapedAt` | DateTime? | Last successful scrape |
| `createdAt` | DateTime @default(now()) | |
| `updatedAt` | DateTime @updatedAt | |

### StudentSavedJob

Tracks student interactions with job listings.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String @id @default(cuid()) | PK |
| `studentId` | String | FK to Student |
| `jobListingId` | String | FK to JobListing |
| `status` | String @default("saved") | "saved", "applied", "interviewing", "offered", "withdrawn" |
| `notes` | String? @db.Text | Student notes |
| `savedAt` | DateTime @default(now()) | |
| `updatedAt` | DateTime @updatedAt | |

Constraint: `@@unique([studentId, jobListingId])`

## Source Adapter System

Each source implements a common interface:

```
fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]>
```

### Adapters

| Adapter | Method | Env Var Required |
|---------|--------|------------------|
| `indeed` | Firecrawl search + scrape | `FIRECRAWL_API_KEY` |
| `ziprecruiter` | Firecrawl search + scrape | `FIRECRAWL_API_KEY` |
| `workforcewv` | Firecrawl scrape (browser rendering) | `FIRECRAWL_API_KEY` |
| `usajobs` | REST API | `USAJOBS_API_KEY` |
| `adzuna` | REST API | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` |
| `jsearch` | REST API (RapidAPI) | `JSEARCH_API_KEY` |

Only sources with configured API keys are available. Missing keys = adapter skipped silently.

### Normalization

All adapters return:
```typescript
interface NormalizedJob {
  title: string;
  company: string;
  location: string;
  salary: string | null;
  salaryMin: number | null;
  description: string;
  url: string;
  source: string;
  sourceType: "scrape" | "api";
  sourceId: string;
}
```

### Salary Parsing

- "$14.50/hr" → `14.50`
- "$30,000/year" → `30000 / 2080 = 14.42`
- "$15-$18/hr" → `15` (take minimum)
- Unparseable → `null`

### Deduplication

1. Exact `sourceId` match → skip (already stored)
2. Fuzzy: same title + company + location across sources → keep the one with more detail (longer description)

## Cluster Matching

After normalization, each job is matched to SPOKES career clusters:

1. Keyword matching against cluster definitions in `src/lib/spokes/career-clusters.ts`
2. Job title → cluster mapping (e.g., "CNA" → "Health Science", "Welder" → "Manufacturing")
3. Matched clusters stored in `JobListing.clusters[]`

## Recommendation Engine

Scores each `JobListing` against a student's `CareerDiscovery` profile:

| Signal | Weight | Method |
|--------|--------|--------|
| Location proximity | 40% | Job in student's enrolled class region = full points, else 0 |
| Cluster match | 40% | Overlap of job clusters with student's `topClusters` |
| RIASEC alignment | 20% | Job's inferred Holland codes vs student's `hollandCode` |

Final score: weighted sum, 0–100.

**Students without assessments:** Skip scoring, show jobs sorted by recency. Display nudge: "Complete your career assessment to get personalized job recommendations."

**Match labels:**
- 75+ → "Strong match"
- 50-74 → "Good match"
- Below 50 → no label

## Scheduling

### Automated Monday Refresh

1. External cron hits `POST /api/internal/jobs/scrape` every Monday at 6:00 AM ET with `CRON_SECRET` bearer token
2. Endpoint queries all `JobClassConfig` where `autoRefresh: true`
3. Enqueues a `scrape_jobs` background job per config (dedup key: `scrape:${configId}`)
4. Job handler runs adapters → normalize → dedup → cluster match → upsert `JobListing`
5. Updates `JobClassConfig.lastScrapedAt`
6. Jobs not refreshed in 2 consecutive cycles → `status: "expired"`

### Manual Instructor Trigger

- `POST /api/teacher/jobs/refresh` with class config ID
- Same pipeline, single config
- Dedup key prevents duplicate runs

### Staleness

- Expired jobs hidden from browse/recommendations
- Still visible to students who previously saved them
- Dashboard widget only shows non-expired jobs

## UI: Dashboard Widget (Mini Cards Grid)

Located on student dashboard. 2-column grid showing top 3-4 recommended jobs.

Each mini card shows:
- Cluster badge (color-coded)
- Match label ("Strong match" / "Good match") if applicable
- Job title
- Company name
- Location
- Salary (prominent, in accent color)

"View all →" link goes to `/jobs` page.

## UI: Jobs Page (Stacked Sections)

Route: `src/app/(student)/jobs/page.tsx`

### Layout (top to bottom)

1. **PageIntro** — eyebrow "Career", title "Job Board", description
2. **Stats row** — 3 cards: Available count, Matched count, Saved count
3. **"Recommended for You" section** — 2-column grid of top recommended jobs with match %, cluster badge, teal left border. Only shows if student has career discovery data.
4. **Inline filters** — dropdowns: Cluster, Salary range, Source, Sort order
5. **"All Jobs" section** — compact list of all active jobs with cluster tag, salary, save button
6. **Assessment nudge** — shown instead of recommendations section if no career discovery data

### Job Interactions

- **Save** — creates `StudentSavedJob` with status "saved"
- **Update status** — dropdown: saved → applied → interviewing → offered → withdrawn
- **Notes** — freeform text per saved job
- **View listing** — external link to original posting (opens new tab)

## UI: Instructor Config (Section on /teacher/manage)

New "Job Board Settings" section on existing `/teacher/manage` page.

### Fields

- **Class selector** — dropdown of instructor's classes
- **Region** — text input (e.g., "Charleston, WV")
- **Radius** — dropdown: 10, 25, 50 miles (default 25)
- **Sources** — checkbox toggles for each available source
- **Auto-refresh** — toggle switch (default on)

### Status Display

- Last refreshed timestamp + job count
- "Refresh Now" button

## API Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/jobs` | GET | student | List jobs for student's class, with recommendation scores |
| `/api/jobs/[id]` | GET | student | Single job detail |
| `/api/jobs/save` | POST | student | Save/update a job (status, notes) |
| `/api/teacher/jobs/config` | GET/PUT | teacher | Read/update class job config |
| `/api/teacher/jobs/refresh` | POST | teacher | Manual scrape trigger |
| `/api/internal/jobs/scrape` | POST | CRON_SECRET | Automated Monday scrape |

## File Organization

```
src/
├── app/
│   ├── (student)/jobs/
│   │   └── page.tsx                    # Jobs page (server component)
│   └── api/
│       ├── jobs/
│       │   ├── route.ts                # GET jobs list
│       │   ├── [id]/route.ts           # GET job detail
│       │   └── save/route.ts           # POST save/update job
│       ├── teacher/jobs/
│       │   ├── config/route.ts         # GET/PUT class config
│       │   └── refresh/route.ts        # POST manual refresh
│       └── internal/jobs/
│           └── scrape/route.ts         # POST cron-triggered scrape
├── components/
│   ├── jobs/
│   │   ├── JobBoardWidget.tsx          # Dashboard mini cards widget
│   │   ├── JobCard.tsx                 # Reusable job card
│   │   ├── JobRecommendations.tsx      # Recommended section
│   │   ├── JobFilters.tsx              # Inline filter bar
│   │   └── JobList.tsx                 # All jobs list
│   └── teacher/
│       └── JobConfigSection.tsx        # Manage page config section
├── lib/
│   ├── job-board/                      # Named to avoid conflict with existing jobs.ts (bg queue)
│   │   ├── adapters/
│   │   │   ├── types.ts               # NormalizedJob interface, adapter interface
│   │   │   ├── indeed.ts              # Indeed Firecrawl adapter
│   │   │   ├── ziprecruiter.ts        # ZipRecruiter Firecrawl adapter
│   │   │   ├── workforcewv.ts         # WorkForce WV Firecrawl adapter
│   │   │   ├── usajobs.ts             # USAJobs API adapter
│   │   │   ├── adzuna.ts              # Adzuna API adapter
│   │   │   └── jsearch.ts             # JSearch API adapter
│   │   ├── scrape-engine.ts           # Orchestrates adapters, dedup, store
│   │   ├── cluster-matcher.ts         # Maps jobs to SPOKES clusters
│   │   ├── recommendation.ts          # Scoring engine (location 40%, cluster 40%, RIASEC 20%)
│   │   └── salary-parser.ts           # Parses salary strings to hourly float
│   ├── jobs.ts                        # Existing background job queue (unchanged)
│   └── jobs-registry.ts               # Add scrape_jobs handler (existing file, modified)
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `FIRECRAWL_API_KEY` | Yes (for scrape sources) | Firecrawl authentication |
| `USAJOBS_API_KEY` | No | USAJobs API access |
| `ADZUNA_APP_ID` | No | Adzuna API access |
| `ADZUNA_APP_KEY` | No | Adzuna API access |
| `JSEARCH_API_KEY` | No | JSearch/RapidAPI access |

## Navigation

- Add "Jobs" to student nav between "Career" and "Learning"
- Dashboard widget added as a new section on student dashboard
- No new teacher nav items — config lives on existing manage page

## Out of Scope

- Real-time job alerts/notifications
- Resume matching beyond career clusters
- Employer-side posting interface
- Job application submission through VisionQuest (students apply externally)
- Salary filtering (display only, per design decision)
