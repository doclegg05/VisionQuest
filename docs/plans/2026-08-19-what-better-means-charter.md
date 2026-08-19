# What better means for VisionQuest

**Status: DRAFT for owner review.** Successor to the lapsed March 23 to June 21 charter window in `docs/PRODUCT_GUIDE.md`, which says plainly that authoring the next window is owner work. This document is that draft, built from Britt's definition of better (2026-08-19) plus a 15-agent verified review of the codebase at commit `2c52e3a`.

**Method:** 8 parallel dimension reviewers (student workflow, instructor workflow, Sage accuracy, Sage speed/reliability, living-agent memory, pathways/CareerOneStop, measurement instruments, ease of use), 6 adversarial verifications of the highest-severity claims, 1 completeness critic. 61 gaps found; every claim below that carries a file citation was checked in code, and the six most load-bearing claims were independently attacked before being accepted. Where a verifier corrected a reviewer, the corrected version is what appears here.

---

## 1. The owner's definition

Britt's words, restructured into eight testable pillars:

1. **One guided path for students.** A clear direction that walks a student through the workflow. Clear instructions.
2. **One command center for instructors.** The same clarity for staff: see, decide, act from one place.
3. **Sage is accurate.** Answers are grounded and true, and something proves it.
4. **Sage is fast and reliable.** A turn completes quickly or fails loudly, never silently.
5. **Sage is a living agent.** It actively monitors each profile, and it is current with every change made natively in the app, without being prompted.
6. **Pathways are assessed and accurate.** The core chain: CareerOneStop assessment, plus the AI's own research, plus the student's wants, produces an accurate goal with a real pathway and a measurable outcome.
7. **Easy to use and understand.** For TANF/SNAP adult learners at a 6th-grade reading level, and for their instructors.
8. **Trustworthy by proof.** (Added by the review.) The living-agent ambition is only acceptable if privacy, oversight, cost, and recovery are proven, not assumed.

One sentence for the wall: **a student goes from "I don't know what I want" to a confirmed, assessed, accurate career goal with a visible pathway and evidence, guided at every step; an instructor sees and steers that journey from one queue; and every Sage property we claim (accurate, fast, reliable, current) has an instrument that would catch it regressing.**

## 2. The headline: what the review actually found

The system is much closer to "better" than the gap count suggests. The architecture for almost every pillar already exists. The pattern across all 61 gaps is one sentence:

> **VisionQuest has built the right machines and then left most of them unplugged, unmeasured, or both.**

Five verified findings carry most of the weight:

**F1. The pillar-6 chain is dark, and credentials alone will not light it.** (CONFIRMED, critical.) The CareerOneStop client (831 lines, 6 endpoint families) and 5 grounding tools exist and are registered, but `COS_USER_ID`/`COS_API_TOKEN` were never provisioned, so every career-data call returns "Live career data isn't connected on this site yet" (`career-grounding-tools.ts:37-47`, absent from `render.yaml`). The verifier added the part nobody had recorded: even with credentials, an assessed Skills Matcher result has **no persistence path**. `CareerDiscovery` has no source/instrument field (`prisma/schema.prisma:1443-1467`), so an assessed profile cannot displace the LLM-inferred RIASEC scores that today drive the Career DNA page, the learning pathway, and the job board's matching.

**F2. Career answer accuracy has zero instruments.** (CONFIRMED, critical.) Across all six eval configs, the strings "riasec", "pathway", "occupation", and "wage" appear zero times. The 5 career grounding tools appear in no eval fixture. No harness anywhere scores the content of a career recommendation. Nuance from verification: 8 of 11 career tools do have tool-routing eval cases, but they are informational (`continue-on-error: true`), and internal cert-pathway math has a real ground-truth parity fixture (`learning-pathway.test.ts`). The precise hole is: no gating eval for any career behavior, and no content-accuracy instrument at all.

**F3. The living agent is built and switched off.** (CONFIRMED, major, several parts.) The daily briefing loop (a headless read-only Sage review of every student, every morning) is fully built and cron-scheduled, and `SAGE_AUTOPILOT_ENABLED` defaults false and is absent from `render.yaml`. The context bundle queries `recentEvents`, `alerts`, and `insights` from the DB on every chat turn and then discards them; they never reach the prompt. The `SageInsight` write loop has no writer. Memory extraction hardcodes `subjectType: 'student'`, `sourceType: 'conversation'`, so instructors and native operations are structurally excluded from Sage's understanding even though the schema supports both.

**F4. Freshness is real but unmeasured, with a 3-to-10-minute blind spot.** (CONFIRMED with mechanism correction.) Native changes reach Sage by per-request DB reads, so gross staleness cannot ship. But the chat context caches (`chat:base-context` 300s, `chat:snapshot` 180s, supplemental 600s) have **no write-through invalidation**: a teacher confirming a goal mid-conversation can be contradicted by Sage's next reply. And no instrument exercises the DB-to-context read plane at all; the route test mocks the assemblers, so a dropped field or wrong where-clause ships undetected.

**F5. Measurement is asymmetric in exactly the wrong direction.** Safety (31 red-team cases) and tool routing are gated in CI, and that is genuinely good. But the properties Britt named are the unmeasured ones: grounding/retrieval accuracy never runs in CI, latency is recorded in `LlmCallLog.durationMs` on every call and then never reported anywhere, no SLO exists, the e2e and a11y suites gate nothing, a11y covers only 3 public routes, and UI copy readability is unmeasured while the audience-critical strings score FK grade 9 to 14.5 against a grade-6 ideal (the login hero is the worst string in the product at 14.5).

Also verified as still open: the tool-call silent-empty hole in `OllamaProvider` (`assertVisibleContent` only throws on `length` finishes, so a `tool_calls` finish still returns `""` silently), and the two-next-engines problem (the dashboard renders `findNextGap` and `getStudentNextStep` output side by side, and they can disagree).

## 3. What is already strong

Worth naming, because the plan builds on it rather than around it:

- One canonical next-step engine with a 7-step journey, rendered identically on all five student pages, with a single Current Target card, why-it-matters copy, and stall nudges.
- A real verification/human-confirmation layer: orientation sign-off, Sage-proposed goals requiring instructor confirmation, cert verification, and the intervention queue.
- Gating red-team evals, prompt-revision stamping, per-call token accounting, and a two-tier CI with 2058 tests and hermetic RLS integration tests.
- A production memory pipeline with hash plus two-layer semantic dedupe and weekly consolidation.
- A grounding stack with tuned hybrid retrieval, an armed abstention floor, and layered anti-fabrication prompts.
- The instrument bench itself: 12+ harnesses (rag, memory, agent, chat, quality, red-team, drift, usage) already written. Most of this charter's measurement work is wiring and thresholds, not new construction.

## 4. The scorecard

Each pillar gets 3 to 5 measures. "Today" is the measured baseline from this review. Instruments marked EXISTS need only thresholds/wiring; EXTEND means a small addition to an existing script; BUILD means new; OWNER means a decision or credential only Britt can supply.

### Pillar 1: one guided path for students

| Measure | Today | Target | Instrument |
|---|---|---|---|
| Orientation is a first-class journey step; incomplete required orientation is always the Current Target | Absent from the model (`student-next-step.ts` never reads orientation state; its own originating spec listed it as an input) | 100% of students with incomplete required orientation see it as step 0 | EXTEND `student-next-step.test.ts` |
| Independent "next" engines rendered on /dashboard | 2 (`findNextGap` + `getStudentNextStep`) | 1 | BUILD contract unit test |
| Discovery-override dead-end states (status complete but pathway empty-state says "complete discovery") | Reachable (`route.ts:50-61` upserts complete without topClusters) | 0 | EXTEND existing route test |
| Direction confirmed before pathway drives coursework | `topClusters[0]` silently becomes the pathway | 100% of pathways carry a confirmation record | BUILD (field + test) |
| Day-1 journey proven end to end (register, welcome, first Current Target) | 0 e2e specs | 1 green spec in CI | BUILD `e2e/student-journey.spec.ts` |

### Pillar 2: one command center for instructors

| Measure | Today | Target | Instrument |
|---|---|---|---|
| Time-decay detection (inactivity ladder, stale goals, evidence gaps) runs unattended | Endpoints exist, never scheduled | 3/3 on pg_cron; a seeded 15-day-inactive student surfaces an alert with zero manual triggers | BUILD migration (pattern exists) + test |
| Failed-extraction backlog visible outside its own page | 0 surfaces | Badge on AI Review nav and/or queue signal | EXTEND NavBar test |
| Core teacher loop (queue, deep link, act, verify) proven in browser | 0 authenticated e2e specs | 1+ green spec; unlocks the seeded user for a11y | BUILD seed fixture + spec |
| Placement pilot flag manageable without curl | API only | Admin UI toggle | EXTEND existing API tests |

### Pillar 3: Sage is accurate

| Measure | Today | Target | Instrument |
|---|---|---|---|
| Retrieval accuracy in CI | Manual only (baseline top1 15/20, top3 20/20, clean 18/20) | Matches or beats baseline on every Sage-touching PR | EXISTS `sage:rag:harness` + CI wiring |
| Grounding (citation) family in CI | Never runs (families gated to tool/guardrail) | Gating after red-baseline soak | EXISTS `sage:chat:harness` |
| Corpus coverage | 50 of 513 ProgramDocuments active | 0 untriaged (each of 463 gets a disposition) | EXISTS `sage:rag:audit` / `activate` |
| Static-fact drift (TOPIC_CONTENT vs FY catalog) | Drift job permanently no-ops (missing DATABASE_URL secret) | Weekly run that executes, 0 findings | EXTEND `catalog:drift` + OWNER secret |
| Tool-selection floor | 80% informational, no floor | Exit nonzero below 75% | EXTEND `sage:agent:eval` |

### Pillar 4: Sage is fast and reliable

| Measure | Today | Target | Instrument |
|---|---|---|---|
| Latency reported | `durationMs` stored on every call, reported nowhere | p50/p95/max per callSite in `sage:usage:summary` | EXTEND (script already selects it) |
| SLO stated and checked | None (nightly harness shows Gemini p95 1816ms; local ~20-70s/turn) | Owner-approved p95 bars, breach flagged in the report | OWNER + EXTEND |
| Cloud request deadline | GeminiProvider has none (a hang spins forever behind a live heartbeat) | Hard deadline + stall timeout, tests red-baseline | BUILD (test file exists) |
| Tool-call silent-empty hole | Open (`assertVisibleContent` passes `tool_calls` finishes through as `""`) | 0 paths return empty without error | EXTEND `ollama-provider.reasoning.test.ts` |
| Provider health visible passively | Admin test button only; /api/health is DB-only | A downed local AI flips /api/health degraded within 2 minutes | EXTEND health route + smoke test |

### Pillar 5: Sage is a living agent

| Measure | Today | Target | Instrument |
|---|---|---|---|
| Native-change freshness window | 180 to 600s TTL, no write invalidation | Under 10s (write-through invalidation of `chat:*` on goal/orientation/cert/memory writes) | BUILD integration test |
| Freshness eval (seed native change, assert it in next context build) | None. The one memory instrument tests chat-sourced extraction only | 100% of an 8-change-type fixture visible in the next context build, gating in CI | BUILD `sage-freshness-eval.mjs` (seeding pattern exists) |
| Autonomous per-profile monitoring | Briefing loop built, cron-scheduled, dark (`SAGE_AUTOPILOT_ENABLED` absent from render.yaml) | 95%+ of active students briefed daily over a 14-day supervised soak | OWNER enable + BUILD count script |
| Sage sees recent events | Queried every turn, discarded before the prompt | Gating chat-harness family where Sage references a post-conversation event | EXTEND `sage:chat:harness` |
| Memory covers instructors and operations | Hardcoded student/conversation only (schema already supports more) | Extended eval passes same gates (dup < 5%, retrieval >= 90%) on teacher and operation subjects | EXTEND `sage:memory:eval` |

### Pillar 6: pathways are assessed and accurate

| Measure | Today | Target | Instrument |
|---|---|---|---|
| CareerOneStop live | Never connected (CRITICAL-PATH since 2026-07-31) | 6/6 endpoint families green in a smoke run before students touch them | OWNER credentials + BUILD `scripts/cos-smoke.mjs` |
| Assessed profile persisted with provenance | Impossible today (no source field, no write path from `career_skills_match`) | 50%+ of new discoveries assessed; 100% of Career DNA pages label their source | BUILD schema field + KPI row |
| Career eval coverage | 0 fixtures for the 5 grounding tools; no content-accuracy instrument anywhere | 5+ gating cases incl. not-configured honesty (no invented wages); pinned-fixture content checks | EXTEND `sage:agent:eval` + fixtures |
| Pathway-to-placement attribution | Bridge closes application to employment only | 100% of new placements carry cluster/pathway provenance; first accuracy report after 10 placements | BUILD provenance field + report |
| Local labor-market grounding in RAG | 15 Phase-B docs staged, not uploaded (blocked on Windows machine) | 3/3 runbook spot-check queries retrieve the right doc top-3 | OWNER (governed upload) + EXISTS harness |

### Pillar 7: easy to use and understand

| Measure | Today | Target | Instrument |
|---|---|---|---|
| Student-facing UI copy reading level | Unmeasured; sampled strings FK 8.4 to 14.5; login hero 14.5 | 100% of scorable strings at or under the owner-confirmed ceiling | BUILD `ui-copy-readability` gate (scorer EXISTS) |
| Authenticated surfaces axe-scanned | 0 (3 public routes only) | 7 student routes + teacher dashboard + student detail, 0 AA violations | EXTEND `test:a11y` (needs seeded user) |
| First-session honesty | Welcome quick-win POST fails silently; readiness % hardcoded /24 | 0 silent catches in first-session components; % matches orientation truth | BUILD `WelcomeFlow.test.tsx` |
| Non-Sage help path | None, for either role (a Sage outage removes all help) | 100% of terminal error states offer a second path; 1 static help route in nav | BUILD help route + e2e assertion |
| Reading-level bar itself | Gate enforces grade 8; product promises grade 6 | Owner decision recorded; gate matches it | OWNER |

### Pillar 8: trustworthy by proof

| Measure | Today | Target | Instrument |
|---|---|---|---|
| FERPA routing honesty | Soft switch (cloud fallback in alpha) with a write-only audit log; nothing reports where PII chat actually ran | AiAuditEvent reader: weekly report of calls by sensitivity x provider; visible flag when local-only data ran on cloud | BUILD report script |
| Student window into Sage's memory | None (teachers have a full inspector; the data subject has nothing; consent packet PDF missing) | Student-visible memory view + delivered consent disclosure | BUILD + OWNER (consent) |
| AI cost | No aggregation, no budget alarm; per-student personal Gemini keys resolve first | Monthly cost/usage report; personal-key policy decided | BUILD report + OWNER policy |
| Backup and restore | No documented backup, PITR, or tested restore for the evidence-of-record store | Documented procedure + one tested restore | BUILD runbook + OWNER verify |
| Classroom concurrency on the local path | Never assessed (Ollama serves serially; 15 students = 5+ min queue for the last) | Load test at 15 concurrent turns; queueing decision recorded | BUILD load script |
| Instructor oversight of Sage guidance | None for routine advice (SageOperation ledger has no viewer; transcripts withheld by the crisis-era decision, never revisited for routine guidance) | Owner decision on scope; at minimum a SageOperation viewer | OWNER + BUILD |

## 5. Phased plan

Sequenced by the house principles: prove-it instruments where they are cheap come first, subtraction before addition, one verifiable unit at a time.

**Phase 0, owner actions (this week, no code).**
Provision `COS_USER_ID`/`COS_API_TOKEN` in Render. Add the `DATABASE_URL` secret the catalog-drift CI job already waits for. Decide the reading-level ceiling (6 vs 8). Decide when to flip `SAGE_AUTOPILOT_ENABLED` for the briefing soak. Confirm retention durations and the ai-data-consent packet (already open items). Decide the personal-Gemini-key policy and the Sage-guidance-oversight scope.

**Phase 1, prove it (instruments first; mostly EXTEND).**
Latency percentiles in `sage:usage:summary` + SLO doc. Career eval family (routing + not-configured honesty + pinned-fixture content checks). Freshness eval script. Gate the memory eval and floor the tool-selection eval. Wire e2e + a11y into CI behind a seeded test user. UI-copy readability gate. `cos-smoke.mjs`. Every new check red-baselines before it gates, per the frozen-grader rule.

**Phase 2, one path (workflow fixes the instruments will hold).**
Orientation into the journey model as step 0. Collapse the dashboard to one next signal. Close the discovery-override dead-end. Honest welcome flow (visible failure, real denominator). Help route + non-Sage fallback on terminal errors. Close the tool-call silent-empty hole and add the Gemini deadline.

**Phase 3, living Sage.**
Write-through cache invalidation on goal/orientation/cert/memory writes (target: under 10s freshness, proven by the Phase 1 eval). Enable and soak the daily briefing. Wire recentEvents/alerts into the prompt and the insight writer into post-response. Extend memory to teacher subjects and operation sources.

**Phase 4, accurate pathways.**
COS live behind the smoke gate. Persist assessed profiles with a source field and a student-confirmed direction moment; label provenance on Career DNA. Land the 15 Phase-B documents (governed upload). Add pathway provenance to placements and produce the first pathway-vs-outcome report. Finish corpus triage.

**Phase 5, trust.**
AiAuditEvent reader and provider-mix report. Student memory view + consent delivery. Cost report and budget alarm. Backup/restore runbook with one tested restore. Concurrency load test and a queueing decision. SageOperation viewer per the owner's oversight decision.

## 6. Ready-to-run goal statements

Three examples in the /goal format (End State, Proof, Constraints, Bound), for the autonomous loop once Britt approves the charter:

**Goal A (latency).** End state: `sage:usage:summary` reports p50/p95/max `durationMs` per callSite and model, and flags any callSite whose p95 exceeds its documented bar. Proof: run the script against dev data; the report shows percentile rows and a breach warning fires on a synthetic slow row. Constraints: extend-only on the existing script; no schema changes; red-baseline the breach check. Bound: one session; if percentile math needs a schema change, stop and report.

**Goal B (freshness eval).** End state: `scripts/sage-freshness-eval.mjs` seeds 8 native change types (goal confirmed, cert approved, orientation item completed, teacher goal edit, memory edit, document activation, alert raised, application status change) and asserts each is visible in the immediately-next context assembly; wired into sage-evals.yml as a gating DB-backed job. Proof: the eval passes locally against the hermetic Postgres pattern; deliberately breaking one invalidation makes it fail. Constraints: follow the `sage-memory-eval.mjs` seeding pattern; do not weaken any existing gate. Bound: two sessions.

**Goal C (career honesty).** End state: 5+ gating agent-eval cases cover the career grounding tools, including a not-configured case asserting the reply refuses to state wages/programs and suggests the instructor. Proof: cases pass 2-of-3 voting on the merged tree; the not-configured case red-baselines against a prompt with the guardrail removed. Constraints: fixtures only; never edit the production guardrail to make an eval pass (recorded house rule). Bound: one session.

## 7. Decision points for Britt

1. Reading-level ceiling: grade 6 (the promise) or grade 8 (the current gate)? The gate should match the decision everywhere (Sage replies and UI copy).
2. Flip `SAGE_AUTOPILOT_ENABLED` for a supervised 14-day briefing soak?
3. CareerOneStop credentials (already CRITICAL-PATH).
4. Personal Gemini keys: keep student-supplied keys resolving before the platform key, or restrict? (Privacy, cost, and audit all fragment through that path.)
5. Instructor oversight of routine Sage guidance: the crisis-era "no transcript access" decision was never revisited for non-crisis advice. What should staff be able to see?
6. Consent and retention: the ai-data-consent PDF and OWNER-CONFIRM durations are prerequisites for the trust pillar.

---

*Presentation copy of this charter is published as the "What Better Means for VisionQuest" artifact. This file is the canonical draft; edits land here first.*
