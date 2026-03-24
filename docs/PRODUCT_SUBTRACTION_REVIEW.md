# VisionQuest Subtraction Review

Status: Active subtraction pass  
Date: March 23, 2026  
Purpose: Remove product scope, navigation, and planning overhead that does not directly support the current VisionQuest charter.

This document applies one rule: subtract first. If a feature, tab, report, or process does not clearly move a student through `direction -> goals -> aligned pathway -> evidence -> intervention`, it leaves the active scope unless a named owner defends it with a measurable reason.

## Cut Rule

Cut by default if any item:

- duplicates another workflow owner
- is motivational but not tied to a real student action
- exists mainly because it sounded useful
- creates a new setup burden for instructors
- adds reporting without changing a decision
- needs a long explanation to justify its existence

## Delete From Active Scope

These items should be removed from the active 90-day product scope even if the code remains for now.

### 1. Student-Facing SPOKES As A Workflow

Why cut:

- It duplicates work already owned by other student tabs.
- Its student value is mostly record display, not progress.
- We already reduced it in navigation and routing.

Relevant implementation:

- [page.tsx](./src/app/(student)/spokes/page.tsx)
- [StudentSpokesHub.tsx](./src/components/spokes/StudentSpokesHub.tsx)

Owner to enforce the cut:

- Product Sponsor

Add back:

- Keep SPOKES as a staff record and reporting area only.

### 2. Vision Board As A Primary Student Module

Why cut:

- It is inspirational, but not part of the core student execution loop.
- It adds a top-level surface without proving better goal follow-through.
- It competes with the actual goal and pathway work.

Relevant implementation:

- [page.tsx](./src/app/(student)/vision-board/page.tsx)
- [dashboard/page.tsx](./src/app/(student)/dashboard/page.tsx)
- [NavBar.tsx](./src/components/ui/NavBar.tsx)

Owner to enforce the cut:

- Product Sponsor

Add back:

- Mention aspiration and future-self framing inside Sage or the welcome flow.
- Do not preserve it as a first-class module unless it improves goal review or persistence in a pilot.

### 3. My Files As A Primary Student Module

Why cut:

- Generic file storage is not a student goal.
- Contextual uploads already belong in orientation, portfolio, applications, and teacher review.
- A generic file bucket encourages dead-end dumping.

Relevant implementation:

- [page.tsx](./src/app/(student)/files/page.tsx)
- [FileManager.tsx](./src/components/files/FileManager.tsx)
- [NavBar.tsx](./src/components/ui/NavBar.tsx)

Owner to enforce the cut:

- Operations Owner

Add back:

- Keep file upload capabilities where they are needed.
- If needed, retain a non-prominent utility route for troubleshooting or power users.

### 4. Resources As A Top-Level Student Tab

Why cut:

- It duplicates ownership already present in Orientation, Courses, Certifications, and goal-linked recommendations.
- The same library already appears contextually in Orientation.
- Students should not have to decide whether a document belongs to orientation, goals, courses, or a generic library.

Relevant implementation:

- [page.tsx](./src/app/(student)/resources/page.tsx)
- [page.tsx](./src/app/(student)/orientation/page.tsx)
- [ResourceLibrary.tsx](./src/components/resources/ResourceLibrary.tsx)

Owner to enforce the cut:

- Operations Owner

Add back:

- Keep the resource system and document routes.
- Surface them only in the tab that owns the action:
  - Orientation for onboarding forms
  - Courses for learning guides
  - Certifications for credential references
  - Goals/current plan for assigned resources

### 5. Events As A Separate Career Surface

Why cut:

- Jobs and events are both transition actions.
- Splitting them creates one more student navigation decision without enough strategic value.

Relevant implementation:

- [page.tsx](./src/app/(student)/events/page.tsx)
- [page.tsx](./src/app/(student)/opportunities/page.tsx)

Owner to enforce the cut:

- Curriculum Owner

Add back:

- Merge events into a single student-facing `Career` area with filters for jobs, events, and next steps.

### 6. Full Setup Wizard Scope

Why cut:

- It solves a future platform problem, not the current student outcome problem.
- It introduces a second product direction: infrastructure for onboarding instructors.
- It is explicitly still a planning artifact.

Relevant planning artifact:

- [SETUP_WIZARD_PLAN.md](./SETUP_WIZARD_PLAN.md)

Owner to enforce the cut:

- Product Sponsor

Add back:

- Replace the wizard with a short admin bootstrap checklist for class setup only.

### 7. Gamification Missions, Rewards, And Kudos

Why cut:

- These are support mechanics, not the main product loop.
- The backlog is large relative to the evidence that adult learners need it.
- If core goal and pathway data is weak, gamification will mostly decorate confusion.

Relevant planning artifact:

- [GAMIFICATION_BACKLOG.md](./GAMIFICATION_BACKLOG.md)

Owner to enforce the cut:

- Product Sponsor

Add back:

- Keep only the progression data hardening work that supports reliable measurement.
- Allow one pilot of lightweight motivation only after the core loop is stable.

## Merge These Surfaces

These should not exist as separate mental models for users.

### 1. Jobs And Events -> Career

- Merge the student-facing career transition actions into one area.
- Keep internal models separate if needed, but stop making students choose between two career tabs.

### 2. Forms, Documents, And Resource Recommendations -> Contextual Resources

- Keep one backend resource system.
- Stop presenting a generic student library as a primary destination.

### 3. Instructor Operations And Coaching -> Two Explicit Workflows

- Do not keep growing a giant `Manage` surface with nine tabs.
- Split the instructor experience into:
  - `Operations`: orientation, files, class requirements
  - `Coaching`: goals, assignments, stalled students, interventions

Relevant implementation:

- [ManageDashboard.tsx](./src/components/teacher/ManageDashboard.tsx)

## Delete Process, Not Just Features

### 1. Delete Planning Artifacts That Behave Like Approved Scope

Current problem:

- planning docs are detailed enough to quietly become commitments

Cut:

- no planning artifact is active scope until it is referenced by the product charter and assigned to a named owner

### 2. Delete Requirements Without One Owner

Cut:

- any requirement without one accountable owner is rejected

### 3. Delete Metrics That Do Not Trigger A Decision

Cut:

- if a metric does not change a teacher action, product action, or reporting obligation, it should not be collected for the active dashboard

### 4. Delete Duplicate Student Edit Surfaces

Cut:

- one job gets one primary owner tab
- dashboards may summarize, but they do not become second editors

## What To Add Back Because A Pure Cut Goes Too Far

This is the deliberate add-back layer. Without it, the subtraction pass would remove too much.

1. Keep a single student dashboard as the launch point to owner tabs.
2. Keep the backend resource library and document models, but remove them from top-level student navigation.
3. Keep the file system, but only as a supporting utility for contextual uploads and staff review.
4. Keep progression and event tracking work that improves data integrity.
5. Keep staff-facing SPOKES records and reports where they support class operations.

## Immediate Decisions

If this subtraction pass is accepted, the next decisions should be:

1. Remove `Vision Board`, `Files`, and `Resources` from active product scope.
2. Plan a merge of student `Events` into a broader `Career` area.
3. Freeze `SETUP_WIZARD_PLAN.md` and `GAMIFICATION_BACKLOG.md` as inactive until re-approved.
4. Simplify teacher product framing away from a giant `Manage` tab set.

## Decision Standard

If a cut feels uncomfortable but no owner can defend the item with a user problem and a metric, the discomfort is not a reason to keep it.
