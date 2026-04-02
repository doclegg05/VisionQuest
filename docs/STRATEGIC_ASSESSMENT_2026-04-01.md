# VisionQuest Strategic Assessment

**Date:** April 1, 2026
**Assessor:** Architecture Review (automated)
**Project Phase:** Phase 1 — Goal Reliability (March 23 - April 19, 2026)
**Days Remaining to Phase 1 Deadline:** 18

---

## A. Current State Assessment

### Where the project stands relative to the 90-day plan

VisionQuest is roughly **40-50% through Phase 1** with 18 days remaining. The product gap closure sprint completed today was genuinely productive — it addressed real pain points (teacher hunting, intervention queue, operational measurement) — but several of those deliverables are Phase 3 concerns (intervention queue, readiness reports, stale goal detection) that were built ahead of Phase 1's core exit gate. The actual Phase 1 exit gate, "goal data matches across student, teacher, and reporting views," is not yet met.

### Phase 1 Exit Gate Status

The Phase 1 exit gate reads: **"Goal data matches across student, teacher, and reporting views."**

| Requirement | Status | Assessment |
|---|---|---|
| Canonical student goal model | **PARTIAL** | Goal hierarchy (bhag/monthly/weekly/daily/task) exists. But there is no `confirmed` status or `confirmedAt` timestamp. The charter says students must *confirm* goals and instructors must be able to *correct and restate* them. The schema has no mechanism for either. |
| Student goal creation, confirmation, editing, review | **PARTIAL** | Creation and editing work. Confirmation is missing as a concept. Review cadence has no tracking field — the stale-goal-rules use `updatedAt` as a proxy for `lastReviewedAt` because the field does not exist on the Goal model. |
| Instructor goal correction and restatement | **MISSING** | No teacher-side goal editing capability exists. Teachers can view goals in StudentDetail but cannot modify, restate, or confirm them. |
| Goal data consistency across views | **AT RISK** | The readiness-monthly report counts *planning-stage* goals as "completed goal levels," overstating readiness. The student dashboard preview for teachers diverges from the actual student dashboard. The intervention queue and readiness reports compute completedGoalLevels differently. |

### Operational Maturity Level

**Early prototype / internal alpha.** The product has substantial breadth — 40+ API routes, 20+ student pages, comprehensive teacher tools — but the operational loops are not yet closed. There is no CI-enforced test gate, no uptime monitoring beyond Sentry, and the deployment runs on Render free tier with 30-60 second cold starts. This is appropriate for a small pilot with a known user base but would not survive a regional rollout.

### Technical Debt

1. **OperationsTab.tsx at 607 lines** exceeds the 400-line target and approaches the 800-line hard limit.
2. **No `lastReviewedAt` on Goal model.** Stale-goal-rules and intervention-queue both hardcode `lastReviewedAt: null`.
3. **Readiness score computed in 5 different places** with subtle divergence across student dashboard, teacher preview, intervention queue, readiness report, and internal reports cron.
4. **Progression state stored as JSON text.** The `Progression.state` field is an opaque JSON blob parsed with `JSON.parse()` + manual extraction, preventing database-level filtering.

---

## B. Critical Gaps (Must Address Now)

### 1. Goal Confirmation Model is Missing (BLOCKS Phase 1 exit gate)

The charter says: "support student goal creation, confirmation, editing, and review." The current Goal model has statuses `active | in_progress | blocked | completed | abandoned` but no `confirmed` status or timestamp. There is no mechanism for a student to formally confirm a goal or for an instructor to confirm/restate it. The 90-day outcome ("90% of students have one confirmed long-term goal") is unmeasurable.

**Fix:** Add `confirmed` status to goals. Add `confirmedAt`, `confirmedBy`, `lastReviewedAt` fields to the Goal schema. Add teacher goal editing/restatement API.

**Effort:** M | **Impact:** Critical

### 2. Readiness Report Overstates Student Progress (data integrity)

The readiness-monthly report counts *all planning-stage goals* (including `active` and `in_progress`) as "completed goal levels" for the readiness score. A student who has merely *set* a monthly goal gets the same credit as one who *completed* it.

**Fix:** Filter to only `status === "completed"` goals before extracting levels. Align with how the student dashboard and intervention queue compute this.

**Effort:** S | **Impact:** High

### 3. Monthly Readiness Report Not Scoped to Requested Month

The route accepts a `month` parameter and computes `startDate`/`endDate` but never uses those dates to filter goals, orientation, or certification data. Returns a lifetime snapshot regardless of requested period.

**Fix:** Either accept that these are point-in-time snapshots and rename/document accordingly, or implement actual time-scoped queries.

**Effort:** S | **Impact:** Medium

### 4. Teacher Cannot Edit Student Goals

No teacher-side goal editing exists. The StudentDetail GoalsPlanTab shows goals read-only. There is no API route for teacher goal editing.

**Fix:** Add `PUT /api/teacher/students/[id]/goals/[goalId]` for status changes, content restatement, and confirmation. Add UI controls in GoalsPlanTab.

**Effort:** M | **Impact:** High

---

## C. Strategic Priorities (Next 30 Days)

| # | Priority | Effort | Impact | Charter Outcome |
|---|----------|--------|--------|-----------------|
| 1 | Add goal confirmation model | M | Critical | "90% have one confirmed long-term goal reviewed within 14 days" |
| 2 | Teacher goal editing/restatement API + UI | M | High | "Let instructors correct and restate goals" |
| 3 | Fix readiness report goal-level overcounting | S | High | Data integrity for all readiness-dependent features |
| 4 | Unify readiness computation into one shared function | M | High | "Goal data matches across views" |
| 5 | Teacher dashboard preview parity | S | Medium | Phase 1 exit gate (views match) |
| 6 | Clarify monthly report as point-in-time snapshot | S | Medium | Report accuracy |
| 7 | Goal-to-pathway mapping model (Phase 2 prep) | M | Medium | "80% have approved pathway linked to confirmed goal" |
| 8 | Class requirement matrix model (Phase 2 prep) | M | Medium | "Every active class has published requirement matrix" |
| 9 | Sage RAG grounding integration | L | Medium | Sage quality for SPOKES-specific questions |
| 10 | Orientation reminder automation | S | Low | Operational loop closure |

---

## D. Architecture and Infrastructure Concerns

### Render Free Tier Limitations

- **Cold starts** (30-60s) are unacceptable for workforce development users with limited patience and intermittent internet access.
- **Cron jobs**: Render free tier does not support cron jobs. The render.yaml defines 3 cron services (appointment reminders, job processor, daily coaching). These may not execute on free tier.
- **Single instance**: No horizontal scaling, no zero-downtime deploys.
- **Recommendation for regional rollout:** Move to Render Starter ($7/mo) at minimum.

### Scaling Readiness

| Concern | Current | Needed for 10 sites (500 students) |
|---|---|---|
| Database | Supabase free tier | Supabase Pro ($25/mo) for connection pooling, backups |
| Compute | Single Render instance | At least 2 instances with health checks |
| Cold starts | 30-60s | Unacceptable; need always-on |
| Cron jobs | 3 declared in render.yaml | Must verify they actually execute |
| AI | Gemini 2.5 Flash (free tier: 60 req/min) | Sufficient for 500 students |

The architecture itself (monolith Next.js + Prisma + Supabase) is appropriate and scalable to ~1000 students without structural changes.

### Data Model Gaps

1. No `confirmed` state on Goal
2. No `lastReviewedAt` on Goal
3. No goal-to-pathway mapping table (Phase 2)
4. No class requirement matrix (Phase 2)
5. Progression state is an opaque JSON blob

### Missing Integrations

- **Sage RAG grounding**: ProgramDocument model has `usedBySage` fields, but dynamic document-based RAG pipeline is not implemented
- **Orientation reminder automation**: Planned but not built
- **Email notifications for interventions**: `intervention-notifications.ts` exists but not wired to cron or queue

---

## E. Product Maturity Gaps

### Testing Coverage

| Category | Count | Assessment |
|---|---|---|
| Unit tests | ~42 files | Reasonable breadth for business logic |
| API route tests | 2 files | **Very thin.** Most 40+ routes untested |
| E2E tests | 3 files | **Minimal.** Only auth and page loading |
| Component tests | 0 files | **Missing entirely** |

Overall coverage is **well below the 80% target**.

### Monitoring and Observability

- **Error tracking**: Sentry configured (client + server + edge) -- good
- **Logging**: Custom structured logger -- good
- **Uptime monitoring**: None configured -- needs external check
- **Alerting**: No PagerDuty/Slack/email alerts on errors or downtime

### UX Polish Items

1. Cold start experience (no loading indicator)
2. Teacher dashboard preview divergence
3. Mobile responsiveness (untested)
4. Empty states audit across pages
5. Sage chat quality limited to static knowledge base

---

## F. Summary

VisionQuest has impressive breadth for a project at this stage. The gap closure sprint added significant operational infrastructure. However, **the project has been building Phase 3 features before the Phase 1 exit gate is met.** The most critical issue is the absence of a goal confirmation model — without it, the 90-day outcome cannot be measured and the Phase 1 exit gate cannot be verified.

**Recommendation:** Spend the next two weeks entirely on goal model completeness and data consistency. Everything else depends on getting the goal foundation right first.
