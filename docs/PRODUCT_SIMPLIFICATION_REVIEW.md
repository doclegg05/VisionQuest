# VisionQuest Simplification Review

Status: Active simplification pass  
Date: March 23, 2026  
Purpose: Refine the surviving product after scope cuts. This document applies only after [PRODUCT_CHARTER.md](./PRODUCT_CHARTER.md) and [PRODUCT_SUBTRACTION_REVIEW.md](./PRODUCT_SUBTRACTION_REVIEW.md).

The rule for this pass is simple:

- do not polish or optimize deleted scope
- do not preserve multiple medium-good workflows when one clear workflow would do
- do not make users choose between pages that answer the same question

## Simplification Principle

The student product should answer five questions only:

1. What direction am I pursuing?
2. What should I do next?
3. What learning path supports that?
4. What proof of progress do I have?
5. Where do I need instructor help?

The instructor product should answer four questions only:

1. Who needs attention now?
2. What is blocking them?
3. What should I assign or review next?
4. What operational record still needs to be completed?

## Target Student Information Architecture

The surviving student experience should compress into these destinations:

- `Home`
- `Goals`
- `Orientation`
- `Learning`
- `Career`
- `Advising`
- `Portfolio`
- `Settings`

Optional global action:

- `Sage` as a primary CTA, launcher, or persistent action rather than a separate mental model competing with every other page

### What This Simplifies

- `Courses` and `Certifications` become one `Learning` destination.
- `Opportunities` and `Events` become one `Career` destination.
- `Goals` remains the source of truth for the current plan.
- `Portfolio` remains the source of truth for shareable proof and resume work.
- `Home` becomes a workflow launcher, not a grid of everything in the app.

## Student Surface Simplifications

### 1. Dashboard -> Home, Not Module Catalog

Current problem:

- the dashboard presents a large module chooser with too many parallel destinations in [dashboard/page.tsx](./src/app/(student)/dashboard/page.tsx)

Simplify to:

- current plan summary
- due now
- next learning action
- next career action
- next advising item
- one obvious `Open Sage` action

Remove from Home:

- large catalog behavior
- duplicate destinations that the navigation already handles
- decorative progress if it does not change the next action

Add back:

- keep readiness and milestone context only if it helps a student choose their next step faster

### 2. Goals Owns The Plan

Current problem:

- goal-linked planning appears in multiple places, including [GoalPlanFocus.tsx](./src/components/goals/GoalPlanFocus.tsx), [courses/page.tsx](./src/app/(student)/courses/page.tsx), and [resources/page.tsx](./src/app/(student)/resources/page.tsx)

Simplify to:

- `Goals` is the only full planning surface
- other pages may show light contextual alignment, but not a second full plan block

Remove:

- repeated “goal-aligned plan” sections on multiple student pages

Add back:

- one short contextual banner like `Aligned with your office/admin goal` where helpful

### 3. Courses + Certifications -> Learning

Current problem:

- courses and certifications are separate destinations even though they represent one student question: `what am I supposed to learn next?`

Relevant implementation:

- [courses/page.tsx](./src/app/(student)/courses/page.tsx)
- [certifications/page.tsx](./src/app/(student)/certifications/page.tsx)

Simplify to one `Learning` destination with sections:

- assigned/recommended pathway
- active platforms
- required certifications
- Ready to Work progress
- optional external badge display

Remove:

- separate top-level mental split between training and credential progress

Add back:

- keep certification-specific detail inside `Learning` as a secondary section or sub-tab

### 4. Opportunities + Events -> Career

Current problem:

- students must choose between jobs and events even though both are transition actions

Relevant implementation:

- [opportunities/page.tsx](./src/app/(student)/opportunities/page.tsx)
- [events/page.tsx](./src/app/(student)/events/page.tsx)

Simplify to one `Career` destination with filters:

- jobs
- events
- applications
- next actions

Remove:

- separate student mental models for `Opportunities` and `Events`

Add back:

- keep internal tables and APIs separate if that lowers implementation risk

### 5. Portfolio Owns Shareable Proof

Current problem:

- shareable proof is split across portfolio/resume work and public credential publishing

Relevant implementation:

- [PortfolioPage.tsx](./src/components/portfolio/PortfolioPage.tsx)
- [CredentialSharePanel.tsx](./src/components/certifications/CredentialSharePanel.tsx)

Simplify to:

- `Portfolio` owns resume, work samples, and shareable proof

Remove:

- public credential sharing as a conceptual branch under `Certifications`

Add back:

- keep the certification eligibility rule, but present the public credential page as one more proof artifact in `Portfolio`

### 6. Settings Should Be Boring

Current problem:

- settings mixes account recovery, API-key onboarding, and Credly integration in one broad page in [settings/page.tsx](./src/app/(student)/settings/page.tsx)

Simplify to:

- account and recovery
- Sage access only when relevant

Remove:

- low-value educational tutorial blocks when a platform-level key already exists
- credential-related integration settings from generic settings

Add back:

- move Credly connection to `Learning` or `Portfolio`, where the user understands why it matters

## Teacher Surface Simplifications

### 1. Replace The Giant Manage Surface

Current problem:

- [ManageDashboard.tsx](./src/components/teacher/ManageDashboard.tsx) is a growing multi-tab control panel with too many unrelated responsibilities

Simplify to three staff destinations:

- `Class Dashboard`
- `Program Setup`
- `Reports & Audit`

Remove:

- giant tab sets that mix setup, live operations, reports, and audit in one place

Add back:

- keep shared components behind the scenes if needed, but stop presenting them as one giant dashboard

### 2. Split Student Detail By Job

Current problem:

- [StudentDetail.tsx](./src/components/teacher/StudentDetail.tsx) is trying to be the whole teacher product in one page

Simplify to four sections or tabs:

- `Overview`
- `Goals & Plan`
- `Operations`
- `Career & Outcomes`

Remove:

- “everything at once” page structure

Add back:

- keep a quick summary header with student identity, readiness, and top alerts

### 3. One Teacher Queue

Current problem:

- teachers can derive action from dashboards, alerts, notes, student detail, and reports, which spreads the intervention decision across too many screens

Simplify to:

- one prioritized review/intervention queue

Remove:

- reporting surfaces that duplicate queue information without changing what the teacher does next

Add back:

- keep a small number of outcome reports for monthly program review

## Design Optimizations After Simplification

Only after the structure above is accepted should the UI be optimized.

### 1. Reduce Navigation Count

Target:

- no more than 8 student destinations
- no more than 4 teacher destinations

### 2. Reduce Duplicate Plan Components

Target:

- one planning owner page
- one contextual summary pattern reused lightly elsewhere

### 3. Reduce Empty-State Explanations

Target:

- every page answers one job clearly without long orientation text

### 4. Reduce Decision Points

Target:

- a student should not need to decide between `resources vs orientation vs files`
- a teacher should not need to decide between `manage vs dashboard vs student detail` for the same task

## Minimal Add-Back Layer

If simplification goes too far, add back only these:

1. A persistent `Open Sage` action, even if Sage stops being a top-level module.
2. A small contextual resource drawer or banner in owner pages.
3. A utility route for files and documents that is not first-class in student navigation.
4. A small certification detail view inside `Learning`.
5. A compact teacher summary header on student records.

## Immediate Simplification Decisions

If this pass is accepted, the next product decisions should be:

1. Rename the student dashboard mentally to `Home`.
2. Plan the `Courses + Certifications -> Learning` merge.
3. Plan the `Opportunities + Events -> Career` merge.
4. Remove repeated `GoalPlanFocus` style sections from non-owner pages.
5. Move public credential sharing out of `Certifications` and into `Portfolio`.
6. Move Credly integration out of generic `Settings`.
7. Replace the teacher `Manage` concept with clearer destination names.

## Acceptance Standard

Simplification is successful only if:

- navigation becomes shorter
- page purpose becomes more obvious
- the same student task appears in fewer places
- instructors need fewer clicks to identify and act on stalled progress
