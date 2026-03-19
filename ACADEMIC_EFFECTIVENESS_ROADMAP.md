# Academic Effectiveness Roadmap

## Strategic Question

Will VisionQuest help students:

- track meaningful goals,
- use the right SPOKES resources to make progress on those goals, and
- help instructors intervene with the right tools at the right time?

## Executive Verdict

Not fully yet.

The current product is a strong advising and readiness platform, but it is not yet a dependable closed-loop academic support system. The main gap is not missing modules. The gap is that the product does not consistently connect:

1. student goals,
2. recommended SPOKES resources,
3. assigned next steps,
4. proof of progress,
5. instructor intervention, and
6. measurable outcomes.

Today, the system is good at visibility and motivation. It is only moderate at academic guidance and weak at proving that resource usage is driving growth.

## Current Strengths

### 1. Strong student workflow coverage

The product already includes the major student surfaces needed for workforce-development support:

- goal-setting through Sage
- orientation
- learning platforms
- forms and documents
- certifications
- portfolio
- files
- dashboard and progression

Relevant implementation areas:

- `src/app/(student)/goals/page.tsx`
- `src/app/(student)/courses/page.tsx`
- `src/app/(student)/resources/page.tsx`
- `src/app/(student)/welcome/WelcomeFlow.tsx`

### 2. Strong instructor visibility

Teachers can already see a broad picture of student progress and advising context.

- class-level dashboard
- student readiness score
- appointments
- follow-up tasks
- case notes
- alerts
- certification state
- portfolio and files
- conversation summaries

Relevant implementation areas:

- `src/app/api/teacher/dashboard/route.ts`
- `src/app/api/teacher/students/[id]/route.ts`
- `src/components/teacher/ClassOverview.tsx`
- `src/components/teacher/StudentDetail.tsx`

### 3. Strong advising/risk signals

The alert system does more than display activity. It identifies students who need intervention.

Current alert types include:

- overdue tasks
- missed appointments
- student inactivity
- low career momentum
- stalled certification progress

Relevant implementation area:

- `src/lib/advising.ts`

### 4. Good readiness framework

The readiness model gives the product a useful organizing concept. It already combines orientation, goals, certifications, portfolio, platform usage, consistency, and progression into a single score.

Relevant implementation area:

- `src/lib/progression/readiness-score.ts`

## Critical Gaps

### Gap 1: Goal capture is too dependent on Sage

Goals are primarily created by AI extraction from chat. If Sage misses the goal, the system has no strong fallback.

Evidence:

- goal extraction happens in `src/app/api/chat/send/route.ts`
- extraction logic is in `src/lib/sage/goal-extractor.ts`
- goals API is read-only in `src/app/api/goals/route.ts`
- student and teacher goal UIs both assume goals appear after talking to Sage

Impact:

- students may not get reliable goal records
- instructors may coach against incomplete or inaccurate goals
- the whole academic loop starts from a fragile input

### Gap 2: Goal lifecycle is incomplete and inconsistent

The system has a goal hierarchy, but not a reliable goal management lifecycle.

Examples:

- progression marks levels as completed when a goal is first captured in `src/lib/progression/engine.ts`
- teacher dashboard calculates `completedGoalLevels` from database goals with `status === "completed"` in `src/app/api/teacher/dashboard/route.ts`
- I did not find a real student goal completion/edit workflow

Impact:

- readiness, progression, and teacher reporting can disagree
- instructors cannot confidently tell whether a student has only named a goal or actually completed it

### Gap 3: Goal-to-resource matching is too shallow

The resource recommendation model is currently keyword-based and narrow.

Examples:

- goal matching is in `src/lib/spokes/goal-matcher.ts`
- platform matching only uses active `bhag` and `monthly` goals in `src/app/api/lms/platforms/route.ts`

Impact:

- recommendations are helpful, but not instructionally strong
- the system does not build a real plan from goal -> resource -> task -> evidence
- students are shown relevant platforms, but not guided through a structured path

### Gap 4: Resource usage is tracked as access, not mastery

The product can detect that a student opened a platform or uploaded a form, but that is not the same as learning progress.

Examples:

- platform usage is recorded through `src/app/api/lms/platforms/visit/route.ts`
- progression awards platform achievements in `src/lib/progression/engine.ts`
- form submission/review exists in `src/app/api/forms/status/route.ts` and `src/app/api/teacher/students/[id]/forms/route.ts`

Impact:

- the system measures participation better than competency
- instructors cannot easily distinguish "opened the tool" from "used it effectively"

### Gap 5: Teacher tools are broad, but not goal-centered enough

Teachers can see a lot of data, but the product does not yet strongly answer:

- Which student goal is stalled?
- Which SPOKES tool should be assigned next?
- What evidence would prove movement on that goal?
- What intervention should happen now?

Impact:

- teachers must do too much interpretation themselves
- the system supports case management more than targeted academic coaching

### Gap 6: Academic outcomes are not yet operationalized

The product does not yet define or report a strong set of academic-effectiveness KPIs.

Examples of missing or weak measures:

- percent of students with a confirmed BHAG
- percent with an active monthly and weekly plan
- time from first login to first goal
- time from goal to assigned resource
- time from assigned resource to evidence of completion
- change in readiness score after interventions
- resource-to-outcome conversion by platform or form type

Impact:

- it will be difficult to prove the system is improving student growth
- product decisions will stay qualitative instead of evidence-based

## Product North Star

VisionQuest should become a closed-loop academic guidance system:

1. student defines a goal,
2. system confirms and structures it,
3. system recommends or assigns the right SPOKES resources,
4. student completes concrete actions,
5. the system captures evidence of progress,
6. instructors see what changed and what to do next,
7. outcomes are measured at student, class, and program levels.

## Priority Roadmap

## Phase 1: Make Goal Tracking Reliable

Timeline: 2-4 weeks

Objective: ensure student goals are trustworthy enough to drive the rest of the program.

### Deliverables

- add student goal CRUD instead of relying on chat extraction alone
- add a "confirm this goal" step after Sage extracts a goal
- define one canonical goal lifecycle:
  - `draft`
  - `active`
  - `in_progress`
  - `completed`
  - `blocked`
  - `abandoned`
- align progression, readiness, and teacher dashboards to the same lifecycle
- let teachers edit, clarify, or restate goals with students

### Key implementation targets

- `src/app/api/goals/route.ts`
- `src/app/(student)/goals/page.tsx`
- `src/components/teacher/GoalTree.tsx`
- `src/lib/progression/engine.ts`
- `src/app/api/teacher/dashboard/route.ts`

### Success criteria

- at least 90% of active students have at least one confirmed BHAG
- goal data shown to students and teachers matches across all views
- instructors can manually correct or complete goal records without using Sage

## Phase 2: Turn Goals Into Resource Plans

Timeline: 3-5 weeks

Objective: connect goals to the right SPOKES tools in a way that produces action, not just discovery.

### Deliverables

- create a goal-to-resource recommendation layer that supports:
  - platforms
  - forms
  - certifications
  - orientation items
  - portfolio tasks
- distinguish `recommended` from `assigned`
- allow teachers to assign a resource or next step to a goal
- create a student-facing "current plan" view:
  - goal
  - recommended resource
  - assigned task
  - due date
  - status

### Key implementation targets

- `src/lib/spokes/goal-matcher.ts`
- `src/app/api/lms/platforms/route.ts`
- `src/app/(student)/courses/page.tsx`
- `src/app/(student)/resources/page.tsx`
- `src/components/teacher/StudentDetail.tsx`

### Success criteria

- at least 75% of active goals have at least one linked resource or assigned next step
- teachers can assign a resource to a goal in under 30 seconds
- students can see exactly what tool or form supports each current goal

## Phase 3: Add Evidence and Intervention Loops

Timeline: 3-5 weeks

Objective: make progress observable and coachable.

### Deliverables

- define what counts as evidence for each pathway:
  - form uploaded
  - form approved
  - orientation item completed
  - certification requirement completed
  - portfolio item created
  - resume created
  - application submitted
  - event registration completed
- tie evidence back to a goal or assigned resource
- add teacher intervention suggestions:
  - student has goal but no assigned resource
  - resource assigned but no action in 7 days
  - repeated platform visits with no evidence
  - completed work awaiting teacher review
- create a review queue for teachers

### Key implementation targets

- `src/lib/advising.ts`
- `src/app/api/teacher/students/[id]/route.ts`
- `src/app/api/teacher/students/[id]/forms/route.ts`
- `src/components/orientation/OrientationChecklist.tsx`
- `src/app/api/portfolio/route.ts`

### Success criteria

- every assigned resource can produce an observable status
- teachers have a review queue based on evidence, not just activity
- intervention alerts map clearly to a recommended next action

## Phase 4: Measure Academic Effectiveness

Timeline: 2-4 weeks

Objective: prove whether the program is improving student growth.

### Deliverables

- define a program KPI set
- instrument the student journey
- add cohort reporting by instructor, platform, and intervention type
- compare readiness movement over time
- report conversion funnel:
  - registered
  - first Sage conversation
  - confirmed BHAG
  - active monthly plan
  - assigned resource
  - evidence submitted
  - certification progress
  - readiness threshold reached

### Suggested KPIs

- percent of students with confirmed BHAG
- percent of students with monthly and weekly goals
- percent of goals with linked resources
- percent of linked resources with evidence
- time from first login to first confirmed goal
- time from goal to first assigned resource
- time from assigned resource to evidence
- readiness score gain over 30, 60, 90 days
- certification completion rate
- portfolio completion rate
- instructor intervention response time

### Success criteria

- the team can identify which SPOKES resources correlate with student progress
- the team can identify where students are dropping out of the support loop
- the product can support program-level reporting, not just individual coaching

## Recommended Build Order

Priority order:

1. Goal reliability
2. Goal-to-resource assignment
3. Evidence model
4. Instructor review queue
5. Outcome reporting

Do not start with more AI sophistication first. The system needs stronger workflow structure before smarter recommendation logic will matter.

## Suggested Data Model Additions

These are conceptual additions, not schema decisions yet.

### Goal confirmation and lifecycle

- `goal.confirmedAt`
- `goal.confirmedBy`
- `goal.statusReason`
- `goal.targetDate`
- `goal.lastReviewedAt`

### Goal-to-resource linkage

- `goal_resource_link`
  - `goalId`
  - `resourceType`
  - `resourceId`
  - `linkType` (`recommended` or `assigned`)
  - `assignedBy`
  - `assignedAt`
  - `dueAt`
  - `status`

### Evidence

- `goal_evidence`
  - `goalId`
  - `resourceLinkId`
  - `evidenceType`
  - `sourceId`
  - `submittedAt`
  - `reviewedAt`
  - `reviewStatus`

## Risks

### Risk 1: Too much dependence on AI

Mitigation:

- every AI-created goal should be confirmable and editable by humans
- do not allow AI extraction to be the only path into the goal system

### Risk 2: Over-scoring superficial activity

Mitigation:

- separate `access` from `progress`
- separate `progress` from `mastery`

### Risk 3: Teacher overload

Mitigation:

- show prioritized interventions, not raw data dumps
- every alert should suggest a next action

### Risk 4: Resource-library fragmentation

Mitigation:

- unify documents, forms, and guidance around the student goal plan
- reduce the gap between "reference library" and "actionable assigned work"

## Definition of Done

VisionQuest can be considered academically effective when:

- students can reliably define, edit, and review goals
- every important goal can be linked to a relevant SPOKES resource
- students can show evidence of working that plan
- instructors can see stalled progress and intervene quickly
- the program can measure which workflows and resources lead to real growth

