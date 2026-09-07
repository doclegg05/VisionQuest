# Research: making the Career tab's job search fluid — the #136 defects and a UX pass

**Date:** 2026-09-07
**Status:** Research memo — one Sonnet build PR to follow, per `docs/plans/2026-09-07-todo-completion-plan.md` D14
**Source reviewed:** the PRODUCT IDEA in `.claude/MEMORY.md` (2026-08-21, "Career tab job search should work more fluidly and be better") and its five cited defects VQ-R-015..019 from the #136 audit; every claim below was re-verified against `main` today rather than trusted from either that note or the #136 PR's "closed dark" comment.
**Related:** `docs/superpowers/specs/2026-09-05-match-and-connect-design.md` §12, `docs/plans/2026-09-04-nlx-macc-job-search-research.md`

---

## Part 0 — Plain language, for Britt

1. Two of the five old bugs are actually fixed. Three are not, despite a PR comment saying "closed dark."
2. The biggest live one: tapping **Save** on a job can silently do nothing. No error, no toast — the button just goes back to normal, and the student never knows.
3. That happens most for students without an active class or without a personalized board, because the job they're looking at lives in a different database table than the Save button checks.
4. A second real bug: if two classes happen to pull in the same national job posting, the second class's overnight refresh can quietly steal that job away from the first class's board.
5. Sage's `/jobs` command and the visible job board are almost the same list — but not quite: teacher-entered leads show up when you ask Sage, never when you scroll the board.
6. The filter row (5 dropdowns + search + 3 tabs) has no visible labels — only screen-reader labels — so at phone width it's a wall of look-alike boxes.
7. There's no "load more" — up to 100 detailed job cards can render in one long scroll.
8. Two separate places track "did I apply" — one for board jobs, one for the curated jobs list — and they don't talk to each other. That's a known, accepted gap, not a bug to fix here.
9. None of this needs new features. It's one focused build: fix the silent failure, fix the database collision, add visible filter labels, add a "show more" button, and delete one unused, buggy component.
10. Two things are genuinely your call: whether to also purge the hardcoded big-tech company boards outright, and whether teacher-entered leads should show up on the visible board (not just through Sage).

---

## 1. The five defects, verified today

| # | Defect (as recorded 2026-08-21) | Status today | Evidence |
|---|---|---|---|
| VQ-R-015 | Elite big-tech boards hardcoded in the default browse pool, no seniority screen | **Partially fixed.** Removed from *defaults* — `DEFAULT_JOB_SOURCES` is now `["careeronestop", "talroo", "usajobs"]` (`src/lib/job-board/source-options.ts:10-14`). But the adapter is unchanged: `DEFAULT_GREENHOUSE`/`DEFAULT_LEVER`/`DEFAULT_ASHBY` still hardcode Airbnb, Anthropic, Coinbase, OpenAI, etc. (`src/lib/job-board/adapters/ats.ts:6-35`), still selectable per class via `greenhouse`/`lever`/`ashby`/`smartrecruiters` in `JOB_SOURCE_OPTIONS` (`source-options.ts:23-26`), and no seniority filter exists anywhere in `ats.ts`. |
| VQ-R-016 | Save button silently fails for browse jobs and unenrolled students | **Still live.** `handleSaveJob` in the live Career page ignores a non-`ok` response entirely — `if (res.ok) { setRefreshKey(...) }`, no `else` (`src/components/career/CareerHub.tsx:141-150`). `POST /api/jobs/save` only ever looks up `prisma.jobListing` scoped to the caller's own class (`src/app/api/jobs/save/route.ts:38-47`) and 400s on anything else. Any student the GET route served from the unkeyed browse pool — no enrollment or no class config (`src/app/api/jobs/route.ts:96-108`) — is handed `JobBrowseListing` rows the Save route cannot find, so every Save tap for them silently no-ops. |
| VQ-R-017 | Two parallel application trackers (`StudentSavedJob` vs `Application`) | **Still live**, unchanged. `StudentSavedJob` FKs to `JobListing` (`prisma/schema.prisma:2213-2229`); `Application` FKs to `Opportunity` (`prisma/schema.prisma:1107-1136`); no shared field, no FK between them. A third path now exists too — a Match & Connect hire creates an `Application` directly (design spec §3) — which also never touches `StudentSavedJob`. |
| VQ-R-018 | Global `sourceId @unique` lets classes overwrite each other's listings | **Still live.** `JobListing.sourceId String @unique` is a bare, program-wide unique key (`prisma/schema.prisma:2163`), and the scrape upsert keys on it alone: `prisma.jobListing.upsert({ where: { sourceId: job.sourceId }, ... })` (`src/lib/job-board/scrape-engine.ts:270-271`). Two classes whose regions both surface the same national posting (a Greenhouse/Lever/USAJobs listing, say) collide: the second class's overnight refresh reassigns that row's `classConfigId`, silently vanishing it from the first class's board. Contrast `JobBrowseListing`, the newer unkeyed pool, which correctly scopes on `@@unique([source, sourceId])` (`prisma/schema.prisma:2207`) — the fix pattern already exists in the same file, just wasn't applied to `JobListing`. |
| VQ-R-019 | Three of four adapters have no fetch timeout | **Fixed.** `fetchJson` applies `AbortSignal.timeout(30_000)` (`src/lib/job-board/adapters/shared.ts:48,70`), and `jsearch.ts:49`, `usajobs.ts:58`, `adzuna.ts:51` each carry a comment citing VQ-R-019 as the reason. |

**Net:** the #136 re-audit's "closed dark" comment is accurate only for VQ-R-019 and half of VQ-R-015 (the default-pool exposure). VQ-R-016, 017, and 018 are live on the exact page a student uses today, and VQ-R-018 is a silent data-integrity bug, not a UX inconvenience.

## 2. UX pass — `/career`, `src/app/(student)/career/**`, at 375px, grade 6

Method follows `.claude/agents/ux-reviewer.md`: cognitive load, mobile-first, 44px touch targets, plain language, error/empty states. The page (`career/page.tsx:11-115`) is a server component (`Opportunity`, `CareerEvent`, `getStudentNextStep` — all DB reads, no blocking external job-API calls on load) rendering `CareerHub` (`src/components/career/CareerHub.tsx`), which client-fetches `GET /api/jobs` on mount with a "Loading jobs..." state (`CareerHub.tsx:188-192`) and a real skeleton in `career/loading.tsx`. Latency is fine; the problems are downstream.

**Prioritized findings:**

1. **Silent Save failure (VQ-R-016), S/M.** Student experience: tap Save, nothing happens, no explanation. Fix: `CareerHub.tsx:141-150` must branch on `!res.ok` and show an inline error ("We couldn't save that job. Try again."); `/api/jobs/save/route.ts` should also accept a `JobBrowseListing` id (or return a distinct, UI-legible error code like `not_your_class_board` so the client can say something specific instead of doing nothing). Same bug exists verbatim in the fully dead `JobBoardWidget.tsx:38-47` (see #6).

2. **Cross-class data collision (VQ-R-018), M.** Not visible to the student directly, but it corrupts what they see: a job silently vanishes from one class's board and appears on another's after a routine scrape. Fix: migrate `JobListing` to `@@unique([classConfigId, sourceId])` (mirroring `JobBrowseListing`'s pattern) and update the upsert `where` in `scrape-engine.ts:270-271` to match. Needs a one-time prod data check first (see §5) since existing collided rows may already have silently lost history.

3. **Sage and the board disagree on what "the job board" is, S then M.** `search_jobs` (`src/lib/sage/agent/job-search-tools.ts:206-213`) reads the identical `JobListing` rows and scorer (`rankJobs`) the `/career` UI uses — good, that half is one dataset. But it also ranks `JobLead` rows an instructor entered (`job-search-tools.ts:230-232, 307-334`), and **no student-facing component anywhere imports `JobLead`** (confirmed by grep across `src/app/(student)` and `src/components`) — a lead Sage recommends cannot be found by scrolling the board. The reverse gap exists too: `explain_job` only looks up `prisma.jobListing` scoped to the student's class (`job-search-tools.ts:537-538`), so asking Sage to explain a browse-pool (`JobBrowseListing`) job 404s. Quick fix (S): tell the student in copy that Sage's `/jobs` may include instructor leads the board doesn't show yet. Real fix (M, and an owner call — see §4/§6): surface `JobLead` rows on the board with an "From your instructor" badge, the same treatment `wv-employer.ts` already gives WorkForce WV postings.

4. **Filter row has no visible labels, M.** `JobFilters.tsx:99-230` renders 3 proximity tabs + a search box + 4 selects (posted-within, min pay, job type, cluster) + a sort select — 9 controls in one `flex-wrap` row, every one labeled only via `sr-only` (`JobFilters.tsx:137-216`). At 375px this wraps into 4-5 rows of visually identical boxes; a low-literacy reader can't tell "Any time" from "Any pay" from "Any type" apart without opening each one. This is exactly the pattern the ux-reviewer agent's own example calls out ("a dropdown with 20 options — a student might freeze"). Fix: short visible label text above each control, or collapse the four secondary filters (posted/pay/type/cluster) behind one "Filters" disclosure that opens a full-width sheet, leaving proximity + search always visible.

5. **No pagination, S.** Up to 100 rows render as one uninterrupted vertical stack (`JobList.tsx:41-47`; both the class path, `route.ts:162`, and the browse-pool path, `browse-jobs.ts:32`, cap at 100). For a student with no personalization signal, that's 100 full `JobCard`s (not the compact variant) in a single scroll with no "show more." Fix: cap the first paint at ~15-20 with a "Show more jobs" button, or real pagination.

6. **Touch target on the proximity tabs, S.** The filter selects correctly use `min-h-11` (44px, `JobFilters.tsx:42`), but the Local/Remote/All tab buttons do not (`JobFilters.tsx:109-120`, only `px-3 py-1.5`). One class name fixes it; folds into the standing D3 touch-targets item in `docs/plans/2026-09-07-todo-completion-plan.md`.

7. **Dead, buggy component, S.** `src/components/jobs/JobBoardWidget.tsx` has zero call sites anywhere in the app or its tests (verified by grep) and carries the same silent-Save bug as #1. Delete it rather than let someone revive a second copy of the same defect later.

## 3. The two-tracker question (VQ-R-017)

`StudentSavedJob` (self-service saves off `JobListing`/browse jobs) and `Application` (the curated `Opportunity` board, and now Match & Connect hires) remain fully separate, per §1. `docs/plans/2026-09-07-todo-completion-plan.md` §4 already records an owner-behalf call: **"`StudentSavedJob` verification fields: no — `Application` is the tracker of record."** That call is sound and this memo does not reopen it: `Application` already carries `verificationStatus`/`verifiedBy`/`pathwayClusterId` (`prisma/schema.prisma:1121-1134`) that grant reporting and the placement bridge depend on, and duplicating that machinery onto `StudentSavedJob` would create a fourth ledger, not close a gap. **Recommendation:** leave the two trackers as-is; the actual fluidity win is making sure a student's job-board activity (`StudentSavedJob.status = "applied"`) at minimum gets a plain-language note pointing them at Opportunities/Connect for anything that should count officially, rather than merging the data models. This is a copy fix, not a schema change.

## 4. Build plan — one Sonnet builder

**Scope:** VQ-R-016, VQ-R-018, and UX findings #4-#7. VQ-R-015's remaining half (purge vs. keep the hardcoded ATS boards) is an owner call (§6) — do not build until answered, to avoid rework.

**Files:**
- `src/app/api/jobs/save/route.ts` — accept a `JobBrowseListing` id path or return a distinct error code (`not_your_class_board`) instead of the current bare 400.
- `src/components/career/CareerHub.tsx:141-150`, `src/components/jobs/JobCard.tsx` — surface the Save error inline (short plain-language message, existing error-state conventions per `.claude/rules/ui-patterns.md`).
- `src/components/jobs/JobBoardWidget.tsx` — delete (dead code).
- `prisma/schema.prisma` (`JobListing`) + a new migration — `@@unique([classConfigId, sourceId])` replacing the bare `sourceId @unique`; `src/lib/job-board/scrape-engine.ts:270-271` upsert `where` updated to the compound key. Use the `database-migration` skill; review generated SQL for the implied index changes.
- `src/components/jobs/JobFilters.tsx` — visible labels (or a collapsed "Filters" sheet) and `min-h-11` on the proximity tab buttons.
- `src/components/jobs/JobList.tsx` (or `BandedJobList.tsx`) — "Show more" pagination past ~15-20 cards.

**Tests:**
- Extend `src/app/api/jobs/save/jobs-save.test.ts`: a browse-pool id now either saves or returns the new distinct error code (not a bare 400); a client-visible error path test on `CareerHub`.
- A migration/RLS-style test asserting two `JobClassConfig`s can each hold a `JobListing` with the same `(source, sourceId)` pair without collision (mirrors the existing `JobBrowseListing` unique-key test if one exists; add one if not).
- `ux-reviewer` re-pass at 375px on the rebuilt `JobFilters` and paginated list before merge.
- Register the new `JobFilters` labels and pagination control with the existing `touch-targets` benchmark suite (`config/benchmarks/`) rather than a new suite — this surface is already in its scope per `.claude/MEMORY.md`'s Known Issues note on `ui-copy:readability`'s `SCAN_ROOTS`.

**Out of scope for this PR:** VQ-R-015's opt-in ATS boards, surfacing `JobLead` on the board (§6), and any change to `Application`/`StudentSavedJob` (§3).

## 5. Owner decisions

1. **VQ-R-015, full close or accept partial.** Keep the hardcoded Greenhouse/Lever/Ashby/SmartRecruiters boards as an opt-in a teacher can still turn on (`source-options.ts:23-26`), or remove them from `JOB_SOURCE_OPTIONS` entirely until a seniority filter exists. No engineering blocked either way; this only changes what the build PR's scope includes.
2. **Surface `JobLead` on the visible board (§2.3), or keep it Sage-only.** This is the design spec's open decision item 5 ("retire `Opportunity` or keep it," `docs/superpowers/specs/2026-09-05-match-and-connect-design.md:121`) and the earlier 2026-09-01 review's **D3** (job-board unification) by another name — both are asking whether VisionQuest should converge on one job-board data model. Recommend: badge leads on the board now (small), defer full unification.
3. **VQ-R-018 migration needs a one-time prod check first**: `SELECT source, "sourceId", count(*) FROM visionquest."JobListing" GROUP BY 1,2 HAVING count(*) > 1;` to see whether any collisions have already silently destroyed a class's copy of a listing before the schema change locks in today's (possibly already-wrong) state as the surviving row.
