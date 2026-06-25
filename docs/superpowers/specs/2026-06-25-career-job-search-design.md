# Design — Wired Career Journey: Discovery → Profile → Resume → Jobs

**Date:** 2026-06-25
**Author:** Britt (doclegg05) + Claude
**Status:** Draft for review
**Topic:** Make Resume Building + Career Discovery + Job Search one coherent, production-ready flow.

---

## 1. Context & Goals

VisionQuest's Sage coach should run a connected career journey: **interview the student → record findings → use them to help search for a job** — while *also* working for a student with little/no info who just wants to **browse the job market**. Jobs must **display cleanly** and **avoid obviously fake or stale postings**.

### User-stated requirements (verbatim intent)
- Resume: upload → Sage suggests → **approve/deny** suggestions → build → the built resume becomes something **Sage can reference moving forward** and that feeds job matching.
- Career Discovery: a **fully wired, flowing** interview that **records findings in memory** and **feeds job search** — no dead-end loop.
- Job Search: works **with** a rich profile (personalized matches) **and without** one (browse the market). Clean display. No fake/old jobs.
- Outcome: a **production-ready** version.

### Non-goals (this design)
- No new job-board UI framework; reuse `CareerHub`/`JobFilters`.
- No resume versioning history UI (single current resume retained; a schema `version` tag is added for safety only).
- No full FERPA query-redaction guard (separate deferred task) — but see §8 for the targeted PII trim included here.

---

## 2. Current State (verified, file:line)

The infrastructure largely exists; the problems are specific wiring/gating bugs.

| Area | Reality | Evidence |
|------|---------|----------|
| Discovery loop | `open_resource("career-discovery")` → `href:"/career"`; rendered as `<a href="/career">` in chat → bounces back. Discovery *is* the chat; no separate destination. | `src/lib/sage/agent/tools.ts:302-306`, `:358-364`; `src/components/chat/ChatWindow.tsx:96-111` |
| 0 jobs | Three hard early-returns: no active enrollment, no `JobClassConfig`, no scraped `JobListing`. | `src/app/api/jobs/route.ts:48-50,53-59,82-88` |
| No local keys | Default sources (`careeronestop`,`usajobs`,`adzuna`) all require keys absent from `.env.local`. Keyless sources are remote/ATS only. | `src/lib/job-board/source-options.ts:1-20`; adapters read `COS_*`,`USAJOBS_*`,`ADZUNA_*`,`JSEARCH_API_KEY` |
| NaN on "All" | The **no-config early-return** returns `{jobs:[],hasDiscovery:false}` with **no** `totalLocal/totalRemote` → `undefined + 0 = NaN` in the filter. (Success path always sets them.) | `src/app/api/jobs/route.ts:49,58` vs `:97-98`; `src/components/jobs/JobFilters.tsx:89-93` |
| `expiresAt` | **Never set** by any adapter/scrape — only *read* for the response. Filtering on it would hide everything. Real freshness today = `scrapeBatchId` + `updatedAt < 2wk` sweep. | `src/app/api/jobs/route.ts:176` (only ref); `schema.prisma:1409` |
| Cross-class collision | `JobListing.sourceId @unique` is **global** → a job seen by class A blocks class B from getting its own copy (upsert's update path doesn't move `classConfigId`). | `prisma/schema.prisma:1406` |
| Resume not in chat | `ResumeData` persists (single row) and feeds job matching, but is **never injected** into Sage's main chat context. | `src/app/api/resume/route.ts`; `src/app/api/jobs/route.ts:135`; `src/lib/chat/context.ts` (no `ResumeData` load) |
| Profile stage-gated | `buildCareerProfileContext` only injects at `career_profile_review` stage; other stages get a short `discoverySummary`. | `src/lib/chat/context.ts:88-173,397-407` |
| Region data | `Region` has no city/state/geocode — only `name`/`code`. Local search area must be **teacher-entered** (`JobClassConfig.region` is free text). | `prisma/schema.prisma:1578-1593`; `:1327` |
| Reusable primitives | Confirmation-token primitive (`createConfirmationToken`/`verifyConfirmationToken`) + `propose_resume_edit` card exist (sections limited to headline/objective/skills/references; token bound to arg shape). | `src/lib/sage/agent/confirmation.ts`; `career-tools.ts:26,65+` |
| Memory | `SageMemory` (vector) exists; `SAGE_MEMORY_ENABLED` absent in dev (operator toggle). | `schema.prisma:~1052-1094` |

---

## 3. Decisions (settled)

1. **Job sources:** CareerOneStop (free DOL key) as WV-local backbone (teacher tier) + keyless remote/ATS sources for the browse tier.
2. **Provisioning — Hybrid (two tiers):**
   - **Market Browse pool:** program-wide, keyless sources, cron-refreshed, available to every student with zero setup.
   - **Local WV jobs:** per-class, CareerOneStop, **teacher-confirmed region**, personalized matching.
3. **Resume review:** per-suggestion **accept/dismiss** checklist; "Apply accepted" writes only accepted changes.
4. **FERPA:** allow cloud Gemini during alpha (logged) — *operator decision*. Design keeps `student_record` tagging, no cloud lock-in (flip to local = one config change), **plus** a targeted contact-PII trim before LLM injection (§8).

---

## 4. Architecture

### 4.1 Two job tiers

```
                    ┌─────────────────────────────────────────────┐
   Student (any) ──▶│ GET /api/jobs                                │
                    │  ├─ Browse tier  (JobBrowseListing, program) │── Remote / All
                    │  └─ Local tier   (JobListing, per-class)     │── Local (if teacher-configured)
                    └─────────────────────────────────────────────┘
   Browse pool ◀── cron refresh (keyless adapters)        [no keys, no region, no per-student trigger]
   Local jobs  ◀── teacher "enable + populate" + auto-refresh (CareerOneStop)  [teacher sets region]
```

- **`available jobs` is decoupled from `personalization`.** Jobs always render. "Matched"/ranking apply only when a profile exists; otherwise sort by proximity + recency.
- The existing **Local / Remote / All** toggle maps onto the tiers: Remote/All → browse pool (+ any remote local-config jobs); Local → teacher-configured local jobs.

### 4.2 Career Profile assembler (connective tissue)

One canonical DB-fetching assembler unifies the three scattered stores:

```ts
// src/lib/career/profile.ts
export interface StudentCareerProfile {
  discovery: CareerDiscoveryView | null;   // interests, strengths, RIASEC, clusters, skills, values
  resume: ResumeSummaryView | null;          // headline, top skills, recent titles, certs (NO contact PII)
  memoryFacts: string[];                     // optional SageMemory facts (when enabled)
  hasPersonalization: boolean;
}
export async function getStudentCareerProfile(studentId: string): Promise<StudentCareerProfile>;
```

- `buildStudentJobProfile` (`src/lib/job-board/recommendation.ts:44-64`) becomes a **pure projection** of `StudentCareerProfile` (no independent `ResumeData` fetch).
- `buildCareerProfileContext` (`src/lib/chat/context.ts:88-173`) is **extended** to consume the assembler so resume skills/headline appear alongside discovery data, and is **un-gated** from `career_profile_review` so Sage can reference the profile in any stage (compact form — see §8).
- Net effect: **one** place fetches the profile; matching and chat both read it.

---

## 5. Components

### C1 — Career Discovery: kill the loop, complete & persist
- **Stop the self-referential link:** during the `discovery` stage, Sage must not render an "Open Career Discovery" resource (the student is already in it). Remove `career-discovery` from `STATIC_RESOURCES` *or* repoint it away from `/career`; add a prompt instruction not to "open" the active surface.
- **Forward action on completion:** when discovery `stage_complete`, surface a forward action — *"See jobs that fit you"* / *"View your career profile"* — instead of a back-link.
- **Persistence:** per-turn upsert already works (`post-response.ts:156-258`); ensure `topClusters` + `transferableSkills` flow into the assembler.
- **Entry banner:** `CareerDnaCallout` reflects partial progress ("Pick up where you left off") and never dead-ends.

### C2 — Profile referenceable everywhere
- Inject the **compact** career profile + resume summary into Sage's main chat (not just discovery stages), via the assembler.
- Route durable findings into `SageMemory` (note `SAGE_MEMORY_ENABLED` operator toggle).
- Update the `careerThreadContext` nudge (`context.ts:377-394`) so it stops firing once a resume exists.

### C3 — Resume: per-suggestion review + reference
- **Structured suggestions:** the extractor returns each improvement as an applyable change `{ field, before, after, rationale }` (not prose).
- **Accept/dismiss UI:** suggestions render as a checklist; each toggles accept/dismiss; **"Apply accepted"** writes only accepted changes to `ResumeData` using the existing confirmation-token primitive.
- **Reference:** resume summary flows through the assembler into chat + matching (C2/§4.2).
- **Safety:** add `ResumeData.version` (schema tag) before writing new shapes; extend `propose_resume_edit` editable sections as needed (token is arg-shape-bound — invalidation across deploy is expected/safe).

### C4 — Job Search: browse pool, clean display, anti-stale
- **Browse pool (new):** `JobBrowseListing` (program-scoped) populated by keyless adapters on a cron; own `@@unique([source, sourceId])` dedup. `/api/jobs` serves it for Remote/All with **zero setup**.
- **Local tier:** teacher "enable + populate" (one-click) creates `JobClassConfig` (idempotent `upsert`), sets region, runs a **background, debounced, in-flight-guarded** scrape (never inside the student GET).
- **Decouple personalization:** active jobs always show; "Matched"/ranking only when `hasPersonalization`; else sort proximity + recency. Default the proximity toggle to "all" so first load isn't empty.
- **Fix NaN:** every `/api/jobs` return path includes `totalLocal/totalRemote`; `CareerHub`/`JobFilters` default them to 0.
- **Clean cards:** title, company, location, pay, employment type, **posted date**, source badge, and a match label only when personalized.

---

## 6. Schema changes (migrations)

All additive / low-risk; reviewed for unintended DROPs.

1. **`JobBrowseListing`** — program-scoped browse pool: `{ id, title, company, location, workMode, salary, salaryMin, employmentType, description, url, source, sourceId, postedAt, expiresAt, status, scrapeBatchId, createdAt, updatedAt }` with `@@unique([source, sourceId])`, `@@index([status, postedAt])`.
2. **`JobListing` freshness:** add `postedAt DateTime?`; **populate `expiresAt` at ingest** (source close-date, else `scrapedAt + 30d`).
3. **`JobListing` cross-class fix:** replace global `sourceId @unique` with `@@unique([source, sourceId, classConfigId])`.
4. **`ResumeData.version Int @default(1)`** — schema-shape tag.

Each ships in its phase; `npx prisma validate` + SQL review before commit; migration names descriptive.

---

## 7. Anti-stale / anti-fake strategy (corrected)

- **Setter then filter:** wire `expiresAt` at ingest (both tiers), *then* filter `expiresAt > now` at query. Add a query-level **max-age** on `postedAt` (e.g., drop > 45 days). Never filter on a field nothing sets.
- **Source trust:** CareerOneStop/USAJobs are government feeds; ATS boards (Greenhouse/Lever/Ashby) are real company postings — low fake risk. Keyless remote adapters get a `postedAt`-based recency drop in `filterQualityJobs`.
- **No silent caps:** if freshness filtering removes everything, the UI says so ("No fresh postings in the last 45 days — widening to all") rather than showing a bare 0.
- Keep existing dedup + `scrapeBatchId`/`updatedAt` sweep as a backstop.

---

## 8. FERPA handling (alpha = cloud allowed, logged)

- Keep `student_record` tagging on chat/extraction/resume paths; provider flip to local stays a one-config change (no cloud lock-in).
- **Targeted PII trim:** strip direct-contact fields (phone, street address, email) from resume text **before any LLM injection** — Sage doesn't need them to coach. (The `ResumeSummaryView` in the assembler excludes contact PII by construction.)
- **Audit tags:** record on `LlmCallLog` which context blocks were included (`resume`, `career_profile`, `prior_summaries`) — categories, not content — so an audit can answer "which calls carried resume data."
- Revisit (flip to local) the moment real students onboard.

---

## 9. Phasing (3 shippable phases; each leaves `main` green)

**Phase 1 — Browse works + clean display + loop fix** *(no keys, no profile dependency)*
- `JobBrowseListing` + keyless cron refresh; `/api/jobs` serves browse pool for Remote/All with zero setup.
- Fix NaN; clean cards; default toggle to "all".
- Anti-stale: `postedAt` + `expiresAt` setter + query filter (browse tier).
- Discovery **loop fix** (cheap, high-value) + completion forward-action.
- *Result: a student with nothing sees real jobs immediately and the loop is gone.*

**Phase 2 — Local tier + profile→matching+memory** *(needs CareerOneStop key — register in parallel)*
- Teacher "enable + populate" one-click; idempotent config upsert; background/debounced/idempotent per-class scrape; `@@unique([source,sourceId,classConfigId])` fix.
- `getStudentCareerProfile` assembler; `buildStudentJobProfile` + `buildCareerProfileContext` become projections.
- Inject compact profile + resume into Sage main chat; route findings to `SageMemory`.

**Phase 3 — Resume review + reference**
- Structured applyable suggestions; per-suggestion accept/dismiss; "Apply accepted".
- `ResumeData.version`; extend `propose_resume_edit`; contact-PII trim + `LlmCallLog` tags; update `careerThreadContext` nudge.

Each phase: TDD, `npx prisma validate`, `npx eslint .`, code + security review.

---

## 10. Open decisions for spec review
1. **Browse pool model:** dedicated `JobBrowseListing` table (recommended, clean dedup) vs. relaxing `JobListing.classConfigId` to nullable + a `scope` discriminator. (Recommend the dedicated table.)
2. **Browse refresh cadence:** daily cron vs. on-demand-with-cache. (Recommend daily cron + 23h debounce.)
3. **Max-age threshold:** 45 days proposed — adjust?
4. **CareerOneStop key timing:** register now (Phase 2 ready on arrival) vs. defer (Phase 2 ships keyless-local-less until key lands).

---

## 11. Key references
- Loop: `src/lib/sage/agent/tools.ts:302-306`, `src/components/chat/ChatWindow.tsx:96-111`
- Jobs API + gates: `src/app/api/jobs/route.ts:48-99,176`
- Sources/adapters: `src/lib/job-board/source-options.ts`, `adapters/registry.ts`, `scrape-engine.ts`
- Profile/context: `src/lib/chat/context.ts:88-173,397-407`, `src/lib/chat/post-response.ts:156-258`, `src/lib/sage/discovery-extractor.ts`
- Resume: `src/app/api/resume/upload/route.ts`, `src/app/api/resume/route.ts`, `src/lib/sage/agent/career-tools.ts`, `confirmation.ts`
- Schema: `prisma/schema.prisma` — `CareerDiscovery:1222`, `ResumeData:489`, `JobClassConfig:1324`, `JobListing:1393`, `Region:1578`, `SageMemory:~1052`
- FERPA routing: `src/lib/ai/provider.ts`
