# Research: should the Portfolio résumé configure the Career tab?

**Date:** 2026-09-07
**Status:** Research memo — awaiting owner decisions (D1–D4 at the end). No code changed.
**Source:** the PRODUCT IDEA recorded by Britt on 2026-08-21 in `.claude/MEMORY.md` ("Portfolio resume should configure the Career tab").
**Related:** `docs/plans/2026-09-04-nlx-macc-job-search-research.md`, `docs/superpowers/specs/2026-09-05-match-and-connect-design.md`, `docs/audits/2026-09-06-ferpa-pii-review.md`

---

## Part 0 — the ten-line answer

1. The résumé is already good data: one JSON row per student with real fields — skills, job titles, employers, dates, schools, certificates (`prisma/schema.prisma:565-573`, `src/lib/resume.ts:52-68`).
2. Half of this idea is already built, and nobody wrote it down. The job board already scores jobs against the student's résumé skills, résumé certificates and past job titles (`src/app/api/jobs/route.ts:193-197`).
3. So a student who did the résumé work already gets better-ranked jobs. What they do not get is a board that went out and *fetched* jobs like theirs.
4. The jobs that arrive are chosen by a fixed list of 16 titles that is the same for every student in the program (`src/lib/job-board/spokes-job-queries.ts:29-47`).
5. That is the real gap, and it is worth more than any re-ranking: ranking can only sort what was already fetched.
6. Three other things the idea names are genuinely missing: the résumé never pre-fills the work profile (ZIP, pay floor), never pre-fills the CareerOneStop skills quiz, and never feeds Career DNA.
7. One thing the idea names has nowhere to go: "experience level" is not stored, filtered or scored anywhere in the app today.
8. The address on a résumé cannot become a ZIP code by itself — the repo has no place-to-ZIP table, and the ZIP field only accepts five digits. That one needs the student to type it, or it needs new reference data.
9. Recommendation: do this as a Sage confirm card ("I read your résumé — want me to set these?"), not a silent background copy. It matches how every other write in this app works, and the student stays the owner of their own data.
10. Estimated size: about a week of engineering for the useful two-thirds. It makes CareerOneStop credentials *more* urgent, not less.

---

## 1. What the résumé actually is

**Storage.** One row per student: `ResumeData { studentId @unique, data String @db.Text }` (`prisma/schema.prisma:565-573`) — the whole résumé as a JSON string, RLS-scoped to its owner (`prisma/migrations/00000000000000_baseline/migration.sql:2094-2096`). Per-opening tailored copies live separately in `ResumeVersion.content Json` (`prisma/schema.prisma:584-604`) and are not the profile of record.

**Shape.** `resumeContentSchema` (`src/lib/resume.ts:52-68`) is genuinely structured, not a blob:

| Field | Type | Structured? |
|---|---|---|
| `headline` | string ≤160 | free text |
| `objective` | string ≤2000 | free text |
| `contact` | `{email, phone, location, website, linkedin}` (`resume.ts:23-29`) | fielded, but `location` is free text ≤200 |
| `skills` | `string[]`, each ≤80 (`resume.ts:62`) | **structured list — the best signal in the app** |
| `experience[]` | `{title, company, location, dates, description}` (`resume.ts:31-37`) | title/company fielded; `dates` and `description` free text |
| `education[]` | `{school, degree, location, dates}` (`resume.ts:39-44`) | fielded except `dates` |
| `certifications[]` | `{name, issuer, dates}` (`resume.ts:46-50`) | fielded except `dates` |
| `references`, `font` | string | free text / enum |

Everything is fail-soft: `parseStoredResumeData` returns `EMPTY_RESUME` on any parse error (`resume.ts:163-171`), and each field `.catch()`es to a default. A derivation built on it can never throw on bad stored data.

**How it gets filled.** By hand in the builder, or by uploading a PDF/DOCX which is parsed to text and then structured by a model against `EXTRACT_PROMPT` (`src/lib/resume-extract.ts:18-28, 31, 117`), normalised through the same schema. Sage can also propose edits to `headline`, `objective`, `skills`, `references` behind a confirm card (`src/lib/sage/agent/career-tools.ts:70-140`).

**One constraint that shapes everything below.** The contact block is deliberately kept out of every model prompt: `withoutContact()` strips it before the assist call and the prompt says so (`src/lib/resume-ai.ts:18-20, 46, 61, 121`; commit `08529e5d`, FERPA review §2.c.3). So **any derivation touching `contact` must be deterministic code, never a model call** — which is fine, because `contact.location` needs a lookup table, not judgement.

## 2. What the Career tab reads today

**The page** (`src/app/(student)/career/page.tsx:22-53, 76-79`) is a shell: `PathToEmployment`, `PendingConnectionsPanel`, `CareerDnaCallout`, then `CareerHub` over `Opportunity` + `CareerEvent` rows. Personalisation happens one layer down.

**The job list.** `CareerHub` fetches `/api/jobs` with student-typed filters — `q`, `cluster`, `proximity`, `sort`, `postedWithinDays`, `minPay`, `jobType` (`src/components/career/CareerHub.tsx:100-138`; parsed at `src/lib/job-board/job-filters.ts:16-25`). Note what is absent: no experience or seniority filter exists.

**The ranker — where the résumé already lands.** `/api/jobs` loads saved jobs, `CareerDiscovery`, and the résumé, then builds a skills profile from **three** résumé fields plus discovery skills (`src/app/api/jobs/route.ts:164-197`; union+dedupe at `src/lib/job-board/recommendation.ts:285-294`):

```
resume.skills + resume.certifications[].name + resume.experience[].title + discovery transferable skills
```

That profile is substring-matched against each posting's text (`recommendation.ts:383-397`) and scored 8 / 14 / `WEIGHT_SKILLS` for one / two / three-plus hits (`recommendation.ts:399-404`), alongside location, cluster, RIASEC, interaction and source-trust terms (`recommendation.ts:537-548`). `hasPersonalization` is true as soon as the résumé yields one skill (`route.ts:205`).

**So the data flow today is:**

- **résumé →** job-board ranking (`/api/jobs`), Sage `search_jobs` (`src/lib/sage/agent/job-search-tools.ts:228-243`, same three fields), Connect `fit()` (`src/lib/connect/matching.ts:295-311, 665-699`) — **but Connect passes only `resume.skills` + transferable skills, dropping certificates and job titles**, then rebuilds the profile from that one field (`src/lib/connect/matching-shared.ts:109, 423`). The two rankers disagree about what the résumé is.
- **`CareerDiscovery` →** cluster and RIASEC scoring (`recommendation.ts:208-222`) and the Career DNA surfaces. Its `profileSource` defaults to `sage_inferred` and the only assessed values are `student_reported_cos` / `cos_api` (`prisma/schema.prisma:1991-1997`, `src/lib/career-provenance.ts:18-39`). **There is no résumé-derived source.** `career-discovery.ts:197-205` also declares a deliberate seam: reported occupations are never inferred onto clusters.
- **`StudentWorkProfile` →** hard blocks and connect-specific score terms. Written by the Settings form (`src/components/settings/WorkAvailabilitySection.tsx:69, 123`) or Sage's five-question intake, which writes **only** availability/transport/payFloorHourly/earliestStart/childcareHours and is explicitly forbidden from touching `homeZip`, `county`, `maxCommuteMinutes`, `shiftLimits` (`src/lib/sage/agent/write-tools.ts:450-540`, comment at :455-461).
- **`JobClassConfig` →** which jobs exist at all: `region`, `radius`, `sources`, `localJobPriority`, all class-level (`prisma/schema.prisma:2081-2100`). And the keywords the adapters query are `getSpokesJobQueryTitles()` — 16 program-wide constants built from cluster sample jobs plus a healthcare/trades supplement (`src/lib/job-board/spokes-job-queries.ts:29-47`), the only callers being the CareerOneStop and Talroo adapters (`adapters/careeronestop.ts:134`, `adapters/talroo.ts:133`). Location scoring likewise uses `classRegion`, never the student's ZIP (`recommendation.ts:177-187`).
- **`career_skills_match`** asks the student to self-rate skill questions from scratch and pre-fills nothing from the résumé (`src/lib/sage/agent/career-grounding-tools.ts:86-127`).

## 3. The mapping

| Career-tab input | Résumé field | Transformation | Verdict |
|---|---|---|---|
| Job-search **keywords/titles** (`getSpokesJobQueryTitles`) | `experience[].title`, `headline` | normalise, dedupe case-insensitively, drop titles already in the program list, cap; union into the per-class query set | **Highest value, not built.** Ranking cannot surface a job nobody fetched. |
| `career_skills_match` self-ratings | `skills[]`, `certifications[].name` | match résumé skills to Skills Matcher `elementId`s; pre-seed a suggested rating the student edits | Built-able; must never rate *for* the student (tool's own rule, `career-grounding-tools.ts:124-127`). Blocked on COS credentials. |
| Connect `fit()` skills | `certifications[].name`, `experience[].title` | pass the two fields Connect already drops (`matching.ts:307-310`) | **~4 lines.** Aligns the two rankers. Changes a `gate` benchmark — see §6. |
| **Experience level** | `experience[].dates` | parse year ranges, sum, bucket | **No destination exists.** No field, filter or scorer consumes seniority (`job-filters.ts:16-25`). Needs a product decision before any code. |
| `homeZip` | `contact.location` | place → ZIP lookup | **Not derivable.** `location` is free text ≤200 (`resume.ts:26`); `homeZip` demands `/^\d{5}$/` (`work-profile-shared.ts:135-139`); the repo has no place/ZIP table. Only a literal 5-digit run in the string is safe to lift. Deterministic code only — the contact block must not reach a model. |
| `county`, `maxCommuteMinutes`, `payFloorHourly` | — | — | Nothing on a résumé states them. Leave to Settings and the intake. |
| **Cluster affinity** (`CareerDiscovery.topClusters`) | `experience[].title` + `description`, `skills[]` | feed the résumé as `{title, description}` into the existing `matchJobToClusters()` keyword+sample-job scorer (`src/lib/job-board/cluster-matcher.ts:11-41`) | Buildable and reuses shipped code. **But** writing `topClusters` crosses the deliberate seam at `career-discovery.ts:197-205` and would need a fourth `profileSource` value. Owner decision. |
| RIASEC / `hollandCode` | — | — | **Do not derive.** A résumé says what someone did, not what they are drawn to. Inferring it would launder inference into the "assessed" label the provenance work exists to protect. |

## 4. Three ways to deliver it

**(a) One-time seed on résumé save.** Hook `POST /api/resume` (`src/app/api/resume/route.ts:24-54`), write derived defaults once when the target field is empty. Cheap and always-fresh-enough. But it writes student-owned rows with no consent moment and no ledger entry, and a first-save from a model-parsed upload could silently seed a wrong ZIP or a wrong pay floor. It is the only option here with no `SageOperation` row, which is a real gap against how every other write in this codebase behaves.

**(b) Live re-derive at read time.** No new columns, nothing to go stale, nothing to un-set. This is exactly what `/api/jobs` already does for ranking, and it is why that part works well. It is the right answer for anything *computed* (search keywords, skill overlap, cluster affinity used for scoring). It is the wrong answer for anything the student may edit — a read-time derivation that overrides a typed pay floor is a bug, and `StudentWorkProfile` is a settings row, not a cache.

**(c) Sage confirm-card proposal.** A `propose_career_defaults` tool in the `propose_resume_edit` shape (`career-tools.ts:70-140`): read the résumé, show exactly what would change, HMAC-sign the payload with a 10-minute TTL (`src/lib/sage/agent/confirmation.ts:1-14`), write only after the student taps confirm, ledger both halves via `recordOperation` (`src/lib/sage/operations.ts:44`). Slower to build and it needs a real chat moment. It is also the only one that respects the repo's stated norm — propose, then human-confirm — for a write into data the student owns.

**Recommendation: (b) for computed signal, (c) for stored settings.** Concretely: derive search keywords, cluster affinity and skill overlap live at read time, where nothing is stored and nothing can go stale; and put the two writes that touch `StudentWorkProfile` behind one confirm card. Do not build (a). The rule it violates is the one the product is built around, and the payoff over (b) is nil.

## 5. Does this make CareerOneStop more or less urgent?

**More urgent, and it sharpens the ask.** Every one of the three highest-value derivations terminates in a CareerOneStop call that returns nothing today:

- Résumé-derived keywords are consumed by `adapters/careeronestop.ts:134`, which returns `[]` without `COS_USER_ID`/`COS_API_TOKEN` (`src/lib/career/careeronestop-config.ts:22-30`). Talroo is the only other consumer.
- Pre-filling the Skills Matcher is inert while `career_skills_match` returns "Live career data isn't connected on this site yet" (`career-grounding-tools.ts:37-49, 112`).

The **deferred interest profiler moves the other way**: it becomes less urgent for *scoring* and no less urgent for *assessment*. Résumé skills already feed the scorers, so the marginal ranking gain from a profiler is small; but résumé-derived signal can never produce a RIASEC profile (§3), so the profiler remains the only path off `sage_inferred`. The honest framing for D1 of the 2026-09-04 memo is unchanged: résumé signal makes the COS credential pay off *sooner*, on more surfaces, for the same request already in flight.

## 6. Scoped build plan

**Slice 1 — align the two rankers (½ day).** `src/lib/connect/matching.ts:307-310` and `:688-691`: pass `resume.certifications[].name` and `resume.experience[].title` into `resumeSkills`, and widen `MatchStudent` (`matching-shared.ts:109`). Tests: extend `matching-shared.test.ts`. **This moves a `gate` metric** — `matching-quality.precision_at_3`, floor 0.80, tolerance 0.03 (`config/benchmarks/matching-quality.json`), whose scorer calls the real `rankLeadFits`. Run `npm run bench -- --tier=gate --compare` and re-baseline with a reason; do not relax the floor.

**Slice 2 — per-student query titles (2–3 days, the valuable one).** New `src/lib/job-board/student-query-titles.ts`: pure, deterministic, `ResumeContent → string[]`, unioned with `getSpokesJobQueryTitles()` under the existing 16-title cap and normalisation rules (`spokes-job-queries.ts:19-47`). Thread class-scoped student titles into the adapters' keyword loops (`careeronestop.ts:134`, `talroo.ts:133`). Tests: pure unit tests for normalisation/dedupe/cap; an adapter test asserting the program titles are never displaced. New benchmark metric on `matching-quality` or a sibling suite: `resume_derived_titles_per_class`, `direction: higher`, `floor: null` with a reason until a first real measurement exists (the `"floor": null` + `reason` rule, `.claude/MEMORY.md` Key Decisions 2026-09-05).

**Slice 3 — the confirm card (2 days).** `propose_career_defaults` in `src/lib/sage/agent/` beside `propose_resume_edit`, `requiredRoles: ["student"]`, `riskTier: "mutate_reversible"`, proposing only fields the résumé genuinely supports — today that is a literal 5-digit ZIP found in `contact.location`, and nothing else. Deterministic extraction, no model call on the contact block. Ledger both proposal and execution. Bump `SAGE_PROMPT_REVISION` (new tool in the catalog). Tests: replay/expiry cases in the `confirmation-use.test.ts` shape; a test pinning that no contact field reaches a prompt.

**Not in scope until an owner decides:** experience level (no destination), `topClusters` writes (crosses a deliberate seam), any RIASEC derivation (refused above).

**Total: ~1 week**, roughly 12 files, no migration if slice 3 writes only existing `StudentWorkProfile` columns.

**Owner vs engineering.** Engineering calls: the normalisation and cap rules, where derivation runs, ledger and confirm mechanics, the benchmark shape. Owner calls: D1–D4 below.

## 7. Unverified points

- Whether real SPOKES résumés carry job titles specific enough to be useful queries (the synthetic cohort is not evidence). One query over prod `ResumeData` counting distinct `experience[].title` values would settle it before slice 2 is built.
- Whether résumé-derived titles improve or dilute board relevance — unmeasurable until COS credentials exist.
- How many students have a résumé *and* an empty `homeZip` — the size of slice 3's payoff.

## 8. Decisions for Britt

- **D1.** Confirm the delivery split: live re-derive for computed signal, one Sage confirm card for stored settings, no silent seed-on-save. (Recommended.)
- **D2.** Should the résumé feed `CareerDiscovery.topClusters`? This crosses the deliberate no-inference seam (`career-discovery.ts:197-205`) and would need a fourth `profileSource` value. Recommended: **no** for now — use résumé cluster affinity for *scoring* only, never written to the Career DNA row.
- **D3.** Does "experience level" get a home — a filter, a badge, a scorer term — or is it dropped from the idea? Nothing consumes it today, so it cannot be built without this answer.
- **D4.** Slice 2 changes what jobs *appear* for a student. Confirm that per-student keywords may displace nothing from the program's 16 titles, only add to them within the cap.
