# VisionQuest Product Charter

Status: Active working charter  
Effective window: March 23, 2026 through June 21, 2026

This charter overrides broader planning artifacts when they conflict with the next 90 days of product work. In particular, it narrows the scope implied by [README.md](./README.md), [ACADEMIC_EFFECTIVENESS_ROADMAP.md](./ACADEMIC_EFFECTIVENESS_ROADMAP.md), [GAMIFICATION_BACKLOG.md](./GAMIFICATION_BACKLOG.md), and [SETUP_WIZARD_PLAN.md](./SETUP_WIZARD_PLAN.md).

Subtraction decisions for this same window are tracked in [PRODUCT_SUBTRACTION_REVIEW.md](./PRODUCT_SUBTRACTION_REVIEW.md).
Simplification decisions are tracked in [PRODUCT_SIMPLIFICATION_REVIEW.md](./PRODUCT_SIMPLIFICATION_REVIEW.md).
Cycle-time decisions are tracked in [PRODUCT_ACCELERATION_REVIEW.md](./PRODUCT_ACCELERATION_REVIEW.md).
Automation decisions are tracked in [PRODUCT_AUTOMATION_REVIEW.md](./PRODUCT_AUTOMATION_REVIEW.md).

## Product Decision

VisionQuest is a student goal-to-action system for the SPOKES program, with staff tools for orientation, file management, and intervention.

It is not, in this 90-day window:

- a second LMS
- a generic case-management platform
- a commercial multi-tenant product
- a gamification-first app

## Primary Jobs To Be Done

### Student

1. Confirm a direction they actually own.
2. Break that direction into short-term goals they review regularly.
3. See which courses, certifications, and class requirements align with those goals.
4. Produce evidence of progress.
5. Get redirected when they stall.

### Instructor

1. Complete orientation and file workflows without hunting across the app.
2. See goal progress and class requirement status in one reliable place.
3. Assign the next action when a student is stuck.
4. Intervene from a prioritized queue instead of reading raw activity.

## 90-Day Outcomes

By June 21, 2026, the product should achieve all of the following:

- 90% of active students have one confirmed long-term goal and one active monthly goal reviewed within the last 14 days.
- 80% of active students have at least one approved course or certification pathway linked to a confirmed goal.
- Every active class has a published requirement matrix with each item marked `required`, `optional`, or `not_applicable`.
- Instructors can identify stalled students from one review queue in under 5 minutes.
- Any gamification shipped in this period must improve at least one real behavior by 10% in a pilot:
  - weekly goal review
  - assigned task completion
  - class requirement completion
  - application or portfolio activity

## Owners

Every workstream must have exactly one accountable owner. If a role is unfilled, the default owner is the Project Owner / Instructor until a named replacement is recorded in the project tracker.

- Product Sponsor: Project Owner / Instructor
- Advising Owner: Lead Instructor for goal model, review cadence, and intervention rules
- Curriculum Owner: Lead Instructor for goal-to-course and goal-to-certification mapping
- Operations Owner: Program Admin or Lead Instructor for orientation, files, and class requirement policy
- Technical Owner: Engineering owner for implementation quality, data integrity, and release decisions

No feature starts until one actual person is recorded against the owning role.

## Approval Cadence

- Monday Product Scope Review: Product Sponsor plus all current owners approve or reject new requirements for the active 90-day window.
- Thursday Delivery Review: Technical Owner plus the affected functional owner accept or reject completed work against acceptance criteria.
- Last business day of each month: Outcome Review led by the Product Sponsor. Any workstream without measurable movement or a clear next decision is cut, paused, or rewritten.

Every approved requirement must exist as a tracked item with:

- sponsor
- accountable owner
- user problem
- why now
- success metric
- kill condition

## Non-Goals For This Window

- Rebuilding a student-facing SPOKES record as a separate workflow
- Adding duplicate student edit surfaces for goals, courses, certifications, portfolio, or opportunities
- Shipping public leaderboards, fake currency, or prize-shop mechanics
- Building commercial multi-tenancy or a full setup wizard platform layer
- Letting AI-created goals count as final without human confirmation
- Adding KPIs that do not change an instructor or product decision

## 90-Day Build Order

### Phase 1: Goal Reliability

Dates: March 23, 2026 to April 19, 2026

- Ship a canonical student goal model.
- Support student goal creation, confirmation, editing, and review.
- Let instructors correct and restate goals.
- Align student, teacher, and progression views to the same goal state.

Exit gate:

- Goal data matches across student, teacher, and reporting views.

### Phase 2: Goal-To-Pathway Alignment

Dates: April 20, 2026 to May 17, 2026

- Maintain a human-owned map from goal categories to approved courses and certifications.
- Support instructor assignment or override for the final pathway.
- Publish class requirement matrices, including whether Ready to Work is required for that class.
- Show students a current plan through existing owner tabs rather than duplicating workflows.

Exit gate:

- Common student goals map to approved pathways, and unmatched goals are explicitly flagged for instructor review.

### Phase 3: Intervention And Evidence

Dates: May 18, 2026 to June 21, 2026

- Build a teacher review queue for stalled goals, missing evidence, and overdue class requirements.
- Tie evidence to assigned work where possible.
- Add only the minimum KPI reporting needed for monthly decisions.
- Run a limited gamification pilot only if Phase 1 and Phase 2 data is trustworthy.

Exit gate:

- Instructors can act from one queue, and any gamification that remains has demonstrated real behavioral lift.

## Requirement Standard

A requirement is rejected by default if it fails any of these tests:

- no single accountable owner
- no user problem
- no measurable outcome
- no approval step
- no kill condition
- duplicates an existing workflow owner in the app
