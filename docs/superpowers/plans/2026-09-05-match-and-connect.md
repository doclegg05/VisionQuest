# Match & Connect + Part 2 Build Order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One task per builder; tests first, shown failing; every phase ships dark behind a flag and is independently mergeable.

**Goal:** Turn VisionQuest from a job board into a placement broker: (a) finish the job-supply and student-search work recommended in Part 2 of the 2026-09-04 research memo, and (b) build Match & Connect — two-sided matching between SPOKES students and local employers, a consented introduction packet with the WV Works subsidy attached, an employer response link, follow-up nudges, and outcome capture that feeds the existing placement records and reports.

**Architecture:** New `src/lib/connect/` module (matching, packets, tokens, pipeline) over three new entities (`Employer`, `EmployerContact`, `JobLead`) plus `StudentWorkProfile`, `Connection`, `ConnectionEvent`, `OutboundMessage`. Reuses the existing scorer sub-functions, `tailor_application` outputs, `confirmationGate`, `ConsentRecord`, `Appointment`/`AdvisorAvailability`, `sendSms`, the placement bridge, and `SpokesRecord`. No new pipeline for postings.

**Tech Stack:** Next.js 16 (App Router), TypeScript (strict), Prisma 6 (PostgreSQL/Supabase, `visionquest` schema, RLS), node:test via `tsx`, Tailwind CSS 4, Phosphor icons, Twilio, S3-compatible storage.

**Spec:** `docs/superpowers/specs/2026-09-05-match-and-connect-design.md`
**Research:** `docs/plans/2026-09-04-nlx-macc-job-search-research.md` (Parts 1–2)

**Test runner:** `npx tsx --test --experimental-test-module-mocks <file>` (single file) or `npm test`. Lint: `npx eslint .`. Types: `rm -f tsconfig.tsbuildinfo && npm run typecheck`. Schema: `npx prisma validate`; migrations via `/migrate` skill; RLS proof comes from CI (never `RLS_TEST_ENABLED` locally).

**Feature flags (SystemConfig):** `connect_enabled_classes` (unset = off; `all` or comma-separated class ids), `sms_nudges_enabled_classes`, existing `placement_bridge_classes`.

---

## Phase 0 — Owner prerequisites (no code; everything below can be built dark while these are pending)

- [ ] **P0.1** CareerOneStop Jobs API access (request submitted 2026-09-04; pending). On arrival: set `COS_USER_ID`/`COS_API_TOKEN` in `.env.local`, run `npm run cos:smoke`, read the `jobsearch.workforceWv*` lines, then set both in Render.
- [ ] **P0.2** Talroo publisher application (talroo.com/publish). Record the key name `TALROO_API_KEY` in `.env.example` when issued.
- [ ] **P0.3** Email Adzuna citing nonprofit use; record the outcome (licence, logo requirement, call cap) in MEMORY.md. Until answered, keep `adzuna` out of `DEFAULT_JOB_SOURCES` for new classes (Task 1.3).
- [ ] **P0.4** State asks, in order (memo Part 2 §Asks): (1) WVDE — the SPOKES statistical-report fields DoHS uses in the FY27 review; (2) Nick Northup — which MACC fields reach LACES and whether a per-student export exists; (3) WorkForce WV — staff/partner MACC accounts for SPOKES instructors; (4) WorkForce WV Business Services — standing referral arrangement and the BSR contact for each class region; (5) DoHS via Sandra Adkins — EIP/ESP referral protocol at SPOKES exit.
- [ ] **P0.5** Consent instrument decision (spec §12.3): digital `employer_referral` consent alone, or paper release-of-information first. Ask Sandra Adkins.
- [ ] **P0.6** Packet contents decision (spec §12.1) and who-may-send (spec §12.2).
- [ ] **P0.7** Twilio: confirm a program-owned sending number and that SMS consent language is acceptable to WVDE.
- [ ] **P0.8** WV Works subsidy rule table sign-off: EIP (50% wage, 200–600 h), ESP (up to 100%, 6 months), WIOA OJT (≥50% up to $6,000 in Region 7), WOTC, Federal Bonding ($10,000). Confirm current figures with the local WV Works office before they appear on an employer page.

---

## Phase 1 — Job supply (small; ships as soon as P0.1/P0.2 land)

### Task 1.1: Talroo adapter
- [ ] `src/lib/job-board/adapters/talroo.ts` implementing `JobSourceAdapter` (`source: "talroo"`, `sourceType: "api"`): zip/radius from class region, hourly focus, map `salary_details` → `salary`/`salaryMin` via the existing salary parser, **keep Talroo's tracking URL as `url`** (their terms), `postedAt` from their date field with the "reposting" caveat in a comment. `isConfigured()` = `TALROO_API_KEY` present. Use `fetchJson` (30 s timeout) with a redacted `logUrl`.
- [ ] `talroo.test.ts`: maps fields, returns `[]` unconfigured, never logs the key, dedupes on their job id.
- [ ] Register in `adapters/registry.ts`; add `{ value: "talroo", label: "Hourly jobs near you", sourceMode: "local" }` to `source-options.ts`; add `TALROO_API_KEY` to `.env.example`.
- [ ] Extend `scripts/cos-smoke.mjs`'s pattern with a `scripts/talroo-smoke.mjs` (exit 2 when unconfigured).

### Task 1.2: Fetch timeouts on the three bare-`fetch` adapters (VQ-R-019)
- [ ] `jsearch.ts`, `usajobs.ts`, `adzuna.ts` go through `fetchJson` so one bad source cannot hang the sweep. Red-baseline: a test that a never-resolving fetch returns `[]` within the timeout.

### Task 1.3: Defaults and terms
- [ ] `DEFAULT_JOB_SOURCES` → `["careeronestop", "talroo", "usajobs"]` (Adzuna returns once P0.3 clears). Update `source-options.test.ts`.
- [ ] Teacher `JobConfigSection` nudge copy: "WV Local Jobs is not on yet" when `careeronestop` is unconfigured.

**Phase 1 acceptance:** with real credentials, `npm run cos:smoke` and the Talroo smoke both pass; a class scrape produces WorkForce WV postings first, hourly postings second, no remote-tech boards unless opted in.

---

## Phase 2 — Student work profile + Sage search/explain (medium)

### Task 2.1: `StudentWorkProfile` model + migration
- [ ] Schema per spec §4; RLS student-own + staff via `managed_student_ids()`; migration via `/migrate`; `npx prisma validate`.
- [ ] `src/lib/connect/work-profile.ts`: `getWorkProfile`, `upsertWorkProfile` (Zod-validated), `availabilityOverlap(profile, schedule) → 0..1`, `transportFeasible(profile, lead) → boolean|unknown`.
- [ ] Tests: overlap math on the 7×4 grid; feasibility matrix (car/ride/bus/walk × transitNotes/distance).

### Task 2.2: Five-question intake
- [ ] Sage write tool `update_work_profile` (`mutate_reversible`, no confirm card; student-own data) with a fixed five-question script: days/times you can work, how you get there, pay you need, earliest start, anything about kids' hours. Grade-6 copy through the readability gate.
- [ ] Student form fallback under `/settings` → "Work availability" (same Zod schema), and a read-only panel on the teacher Student Detail Overview tab.
- [ ] Tests: tool writes only the five fields; teacher panel renders "not set" cleanly.

### Task 2.3: `search_jobs` (read) and `explain_job` (read)
- [ ] `search_jobs`: at most three results from the class `JobListing` pool (Phase 3 adds `JobLead`), filtered by hard blocks from the work profile, ranked by the existing scorer, each with a one-sentence reason. Registered with `requiredRoles: ["student"]`; platform map + `SAGE_PROMPT_REVISION` bump; agent eval case added (tool selection, 2-of-3 voting).
- [ ] `explain_job`: fixed template (What you'd do / Hours / Pay / Must-haves / How you'd get there), local provider for the rewrite, readability check ≤ grade 6 on output, refusal path when the posting lacks a field ("The posting doesn't say the pay.").
- [ ] Read-aloud button on the job card and the explain card (`speechSynthesis`, no library).
- [ ] Red-team scenario: `search_jobs` must not fabricate a posting; guardrail eval must stay green.

**Phase 2 acceptance:** a student with a work profile asks Sage "what jobs fit me" and gets three real postings with reasons; a posting can be explained at grade 6 and read aloud; `sage:agent:eval`, `sage:redteam:eval`, `ui-copy:readability` green.

---

## Phase 3 — Employers, leads, and the job developer console (medium-large)

### Task 3.1: `Employer`, `EmployerContact`, `JobLead` models + migration
- [ ] Schema per spec §4 (staff-only RLS; students read `JobLead` rows for their class only; never `EmployerContact`). Migration; validate.
- [ ] Backfill script `scripts/backfill-employers.ts` (dry-run default): distinct `Opportunity.company` and `SpokesRecord.employerName` → `Employer` rows; `Opportunity` → `JobLead(source: "opportunity", sourceRef)`. Idempotent; read-back assertion; prod run is an owner step.

### Task 3.2: Lead capture
- [ ] Teacher route + form: add a lead by hand, from a `JobListing` (one click on the board: "Make this a lead" — copies fields, links `sourceRef`), or from a MACC job order (fields typed from the order).
- [ ] Zod schema for `requirements`/`schedule`; `logAuditEvent` on create/update; tests.

### Task 3.3: Matching engine
- [ ] `src/lib/connect/matching.ts`: `fit(student, lead)` with hard blocks + soft score per spec §5, reusing `scoreLocation`/`scoreCluster`/`scoreRiasec`/`scoreSkills`/`scoreSourceTrust` (export them from `recommendation.ts`, no behaviour change there — red-baseline the existing recommendation tests).
- [ ] `rankStudentsForLead(jobLeadId)` and `rankLeadsForStudent(studentId)`; `search_jobs` (Task 2.3) switches to include leads.
- [ ] Tests: each hard block; overlap ratio; verified-cert bonus only for `verificationStatus: verified`; reasons rendered at grade 6.

### Task 3.4: Job developer console `/teacher/connect`
- [ ] Leads board with "who fits" counts; students board with "best leads"; employer directory with relationship owner, hire history, subsidy flags; "Batch to WorkForce WV" (exports this week's ready graduates as one PDF/CSV for the BSR — `csvEscape` from `src/lib/csv.ts`).
- [ ] Wire the dormant per-application Verify button in `ProgressTab.tsx` (API exists).
- [ ] `recordStudentView` on every student-data read here; a11y at 375px (ux-reviewer pass); readability gate on copy.

**Phase 3 acceptance:** an instructor adds a lead from a WorkForce WV posting, sees the three students who fit and why, and the two who are blocked and why; `Opportunity` reads come from `JobLead` behind a flag.

---

## Phase 4 — The Connection (large; the core of the initiative)

### Task 4.1: `Connection`, `ConnectionEvent`, consent scope
- [ ] Models per spec §4; unique `[studentId, jobLeadId]`; state machine in `src/lib/connect/pipeline.ts` with an allowed-transitions table and a test that enumerates every transition (legal and illegal).
- [ ] `ConsentRecord` scope `employer_referral` in `src/lib/consent.ts`; `ConsentSection` gains the toggle with grade-6 copy; revocation withdraws all non-terminal connections.
- [ ] `/memory` page gains "Shared with employers": every packet ever sent, what it contained, when, to whom.

### Task 4.2: Packet assembly
- [ ] `src/lib/connect/packet.ts`: choose or create a `ResumeVersion` + `CoverLetter` for the lead (extend both models with nullable `jobLeadId`; migration), collect verified certs, availability + earliest start from the work profile, endorsement text, subsidy line from `src/lib/connect/subsidies.ts` (rule table from P0.8, with a `verifiedAt` date on every figure).
- [ ] Endorsement drafting on the **local** provider from verified facts only (certs, attendance, instructor notes); instructor edits before send; `neverContain` canaries for invented experience.
- [ ] PDF render of the packet through the existing document path; presigned GET for the employer page.
- [ ] Tests: packet field list equals what the student approved; no field outside the allowlist; subsidy line absent when flags unknown.

### Task 4.3: Propose → approve → send
- [ ] `propose_connection` write tool (`mutate_consequential`, `confirmationGate`, `targetStudentId` threaded) and the teacher-side propose action.
- [ ] Student approval card (one screen, one action, shows the exact packet); approval freezes `Connection.packet`; Sage cannot approve.
- [ ] Send: create employer token (sha256 hash stored, 14-day expiry, one contact), email via `sendNotification*` with the instructor as sender of record, `OutboundMessage` row, rate limit three packets per employer per week (atomic counter, fail-closed), honour `do_not_contact`.
- [ ] Tests: no send without student approval; no send without consent scope; token hash never logged; rate limit enforced.

### Task 4.4: Employer response page `/connect/[token]`
- [ ] Public route in the `credentials/[slug]` pattern using `prismaAdmin` through a bounded helper (token → connection only; no student id in the URL or the page source); expired/used tokens render a neutral page.
- [ ] Shows: packet summary, PDF link (presigned), subsidy explainer, three actions. *Interested* → pick from `AdvisorAvailability`, creates `Appointment` with new nullable `externalAttendee Json` ({name, email, employerId}); *Not now* → optional reason; *Hired* → start date + wage.
- [ ] Every view logged as a `ConnectionEvent` (`employer_viewed`), CSRF-exempt GET only, POST actions require the token in body and pass origin checks; a11y pass; no analytics scripts.
- [ ] Tests: token replay after `hired` is refused; expired token; each action's transition; no PII in logs (ESLint rule covers it).

### Task 4.5: Outcome capture
- [ ] `hired` → create `Application` (`verificationStatus: "verified"`, `verifiedBy` = sending instructor), set `Connection.applicationId`, fire the placement bridge (make `placement_bridge_classes` follow `connect_enabled_classes`), prefill the SPOKES form with employer, start date, wage.
- [ ] `withdrawn` by student from any state; `closed` by instructor with reason; both notify the other party.
- [ ] Tests: hire path end-to-end creates exactly one `Application` and one `placement_outcome_pending` alert; idempotent on retry.

**Phase 4 acceptance:** an instructor proposes, a student approves, the employer receives a link, taps Interested, books a slot; taps Hired after the interview; the SPOKES record shows the placement without re-entry. Full ledger visible on the student's `/memory` page and the teacher's operations viewer.

---

## Phase 5 — Nudges and retention (small-medium)

### Task 5.1: SMS layer hardening
- [ ] `NotificationPreference.smsConsentAt`, quiet hours (21:00–08:00 America/New_York), per-recipient daily cap, `OutboundMessage` log for every send, every body names SPOKES, STOP handling via Twilio's built-in with a webhook that revokes consent.
- [ ] Tests: no send without consent; quiet-hours deferral; cap; STOP revokes.

### Task 5.2: Nudge schedule (pg_cron → internal route, `CRON_SECRET`)
- [ ] Employer: no view in 3 days → instructor task; no response in 7 → instructor re-send prompt (never an automatic re-send).
- [ ] Student: weekly opt-in "N new jobs near you. Reply Y" (fed by `rankLeadsForStudent`); interview confirmation; "did you hear back?" 7 days after a self-directed apply, answer updates `StudentSavedJob`.
- [ ] Retention: 30/60/90 days after `started`, "Still working at X? Reply Y or N"; Y/N writes `SpokesEmploymentFollowUp`; N opens an instructor task.
- [ ] Register jobs in the cron migration pattern from PR #187 (guarded, byte-identical commands, runbook ordering).

**Phase 5 acceptance:** with `sms_nudges_enabled_classes` set for one class, a consenting student receives the weekly text and a retention text on schedule; nothing is sent to anyone without consent; the outbound log matches Twilio's.

---

## Phase 6 — Reporting (medium)

### Task 6.1: Funnel
- [ ] `src/lib/connect/funnel.ts`: per class, per employer, per period: proposed → approved → sent → viewed → interested → interviewed → hired → started → retained 30/60/90; medians for send→response and send→hire; subsidy attached vs not; comparison line for self-directed applications.
- [ ] `/teacher/connect/report` page and a `GET /api/teacher/reports/connect` route; tests on the aggregation.

### Task 6.2: DoHS-facing export
- [ ] Once P0.4(1) answers, `scripts/dohs-spokes-report.ts` + a teacher export button producing exactly those fields from `SpokesRecord` + `Connection` + `Application`; `csvEscape`; audit-logged.
- [ ] Promote `pathway-outcomes` from script-only to a report route (it already joins placement to pathway).

**Phase 6 acceptance:** the grant KPI report and the DoHS export agree on placements; the funnel shows where connections stall.

---

## Cross-cutting

- Every phase behind its flag; `SAGE_AGENT_MODE` governs the Sage tools; ship dark first (autopilot precedent).
- Reviews per phase: `code-reviewer` + `security-auditor` (Phases 3–5 touch third-party sharing; treat every WARNING as a build instruction); `database-architect` on each migration; `ux-reviewer` on every student- and employer-facing screen at 375px.
- Evals: `sage:agent:eval`, `sage:redteam:eval`, `sage:memory:eval`, `ui-copy:readability` stay green on every Sage-touching PR.
- Privacy: `studentLogKey` only in logs; local provider for résumé/endorsement text; no student id in any employer-visible URL; `recordStudentView` on staff reads.
- Never: auto-apply, employer-facing scores, a second tracker, a benefits number without "check with your worker".

## Sequencing and size

| Phase | Depends on | Size | Ships value alone? |
|---|---|---|---|
| 1 Supply | P0.1, P0.2 | S | Yes — WV postings live |
| 2 Work profile + Sage search | — | M | Yes — better matches, grade-6 explanations |
| 3 Employers + console | 2 | M–L | Yes — instructor sees who fits what |
| 4 Connection | 3, P0.5, P0.6 | L | Yes — the broker loop |
| 5 Nudges | 4 (partly 2), P0.7 | S–M | Yes — RCT-backed lever |
| 6 Reporting | 4, P0.4 | M | Yes — funding evidence |

Recommended order: 1 and 2 in parallel now (both are dark until credentials/flags), then 3, then 4, with 5 and 6 following. Phase 4 is the first point at which a student and an employer are actually brought together; everything before it makes that introduction honest and everything after it makes it count.

## Final verification (per phase)
- [ ] `npx eslint .` clean; `rm -f tsconfig.tsbuildinfo && npm run typecheck` clean; `npx prisma validate`; targeted suites green; CI green including RLS integration and gating evals.
- [ ] Red-baselined tests for every guard listed under Cross-cutting.
- [ ] MEMORY.md updated: flags, migrations applied where, owner steps remaining.
