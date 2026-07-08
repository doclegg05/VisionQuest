# Handoff: Student Employment Workflow Redesign

Created: 2026-07-08

## Purpose

Make VisionQuest feel like one clear path to employment for adult learners. The current app has strong pieces: Sage, goals, learning resources, portfolio, resume tools, job search, and advising. The next agent should connect those pieces into a visible workflow where a student can quickly answer:

- What job path am I working toward?
- What should I do today?
- What proof do I have?
- What do I still need before applying?
- Who can help if I am stuck?

No code changes were made while preparing this handoff.

## First Steps for the Next Agent

1. Read `AGENTS.md` first.
2. Then read only the relevant project docs:
   - `docs/PRODUCT_GUIDE.md`
   - `docs/PRODUCT_DECISIONS.md`
   - `docs/ACADEMIC_EFFECTIVENESS_ROADMAP.md`
   - `.impeccable.md`
3. Check the worktree before editing. At handoff time, unrelated modified/untracked files already existed. Do not revert them unless the user explicitly asks.
4. Preserve product decisions from `docs/PRODUCT_DECISIONS.md`, especially:
   - Chat-first Home is the primary student surface.
   - Vision Board remains secondary navigation.
   - Files are shown as Documents.
   - Resources route is retained even if not primary nav.
   - Orientation returns as archive after completion.

## Current State Summary

Key student workflow files:

- `src/app/(student)/dashboard/page.tsx` - chat-first Home with Sage and ambient progress panels.
- `src/components/dashboard/AmbientPanels.tsx` - readiness, next gap, alerts, tasks, appointments, orientation, resume nudge.
- `src/app/(student)/welcome/WelcomeFlow.tsx` - first-run student onboarding flow.
- `src/lib/nav-items.ts` - student navigation structure.
- `src/lib/nav-progression.ts` - phase-based nav gating.
- `src/components/ui/NavBar.tsx` - desktop/sidebar/mobile nav and Sage button.
- `src/app/(student)/goals/page.tsx` - Goals page wrapper.
- `src/components/goals/GoalsPageClient.tsx` - goal CRUD, proposed goals, confirmation, next-best action ribbon, goal-resource status UI.
- `src/components/goals/GoalPlanFocus.tsx` - goal-linked current/recommended resources.
- `src/components/goals/StudentPathwayPlan.tsx` - approved pathway display.
- `src/app/(student)/learning/page.tsx` - learning surface with pathways, courses, Credly, certification tracking.
- `src/app/(student)/portfolio/page.tsx` and `src/components/portfolio/PortfolioPage.tsx` - portfolio, resume builder, shareable proof.
- `src/components/portfolio/ResumeBuilder.tsx` - resume upload, Sage extraction/rebuild, ATS text, PDF/print.
- `src/components/portfolio/PortfolioGrid.tsx` - proof item creation.
- `src/app/(student)/career/page.tsx` and `src/components/career/CareerHub.tsx` - opportunities, events, live jobs, saved/matched jobs.
- `src/app/(student)/appointments/page.tsx` and `src/components/advising/StudentAdvisingHub.tsx` - advising, alerts, follow-up tasks.
- `src/lib/chat/commands.ts` - starter chips and slash commands.
- `src/lib/sage/system-prompts.ts` - Sage behavior and tool instructions.
- `src/lib/sage/stage.ts` - conversation stage detection.
- `src/lib/goal-resource-links.ts` - goal resource link types/statuses.
- `src/lib/academic-kpi.ts` - current academic funnel and KPI computation.
- `src/lib/progression/readiness-score.ts` - current readiness score.
- `prisma/schema.prisma` - Goal, GoalResourceLink, PortfolioItem, FileUpload, CareerDiscovery, StudentSavedJob, StudentTask, StudentAlert.

Existing strengths:

- Sage is already central and can stream chat responses.
- Goals support confirmation, hierarchy, status tracking, and assigned resources.
- Learning and Resources have goal-aware components.
- Resume, portfolio, saved jobs, job matching, cover letters, and interview prep already exist or are represented through Sage tools.
- Advising alerts and follow-up tasks can support students when they are blocked.
- Academic KPI scaffolding already tracks much of the funnel.

Main gaps:

- The employment journey is implied, not explicit.
- "What do I do next?" is fragmented across Home, Goals, Learning, Portfolio, Career, tasks, and alerts.
- Prior experience is captured but not visibly transformed into resume bullets, portfolio proof, or job-match strengths.
- Evidence is not canonical. Portfolio items and files are useful, but they do not clearly link to goals or assigned resources.
- Sage's job-search abilities are not visible enough in starter actions.
- Readiness scoring underweights the real employment pipeline: resume, portfolio proof, saved jobs, applications, interviews, follow-up.

## Target Student Workflow

Design for this path:

1. Discover - connect past experience, strengths, needs, and career interests.
2. Focus - confirm a career goal and a short-term learning goal.
3. Plan - assign a pathway, resource, certification, form, or task.
4. Learn - complete the next skill-building action.
5. Prove - attach evidence such as a certificate, work sample, document, resume bullet, or reflection.
6. Prepare - build resume, portfolio, interview stories, and job-match materials.
7. Apply - save jobs, tailor materials, apply, track status, and prep interviews.
8. Support - surface barriers, advising, alerts, and follow-up tasks.

Recommended visible labels for the student-facing journey:

- Discover
- Goal
- Learn
- Prove
- Prepare
- Apply
- Follow Up

Keep language plain and adult-respectful. Avoid childish gamification or decorative complexity.

## Research Anchors

Use these to justify design decisions:

- LINCS Adult Learning Theories: adults are more self-directed, draw on life experience, want immediate application, and learn through real-life problems. https://lincs.ed.gov/sites/default/files/11_%20TEAL_Adult_Learning_Theory.pdf
- LINCS Employability Skills Framework: employability includes Applied Knowledge, Effective Relationships, and Workplace Skills. https://lincs.ed.gov/federal-initiatives/employability-skills-framework
- U.S. Department of Labor Career Pathways Toolkit: career pathways connect education/training, employer needs, credentials, and measured outcomes. https://www.dol.gov/sites/dolgov/files/ETA/advisories/TEN/2015/TEN_17-15_Attachment_Acc.pdf
- CareerOneStop job-search planning: prepare a base resume and cover letter, then customize for each job opening. https://www.careeronestop.org/JobSearch/Plan/create-a-job-search-plan.aspx
- CareerOneStop work samples: portfolios should help job seekers select and present proof of work. https://www.careeronestop.org/JobSearch/Resumes/work-samples.aspx
- CareerOneStop interview preparation: interview prep is a distinct job-search step. https://www.careeronestop.org/JobSearch/Interview/interview-tips.aspx

## Implementation Plan

### Phase 1: Make the Path Visible

Goal: Add journey clarity without schema changes.

Suggested implementation:

- Create a reusable Path to Employment component, for example:
  - `src/components/student/PathToEmployment.tsx`
  - or `src/components/progression/PathToEmployment.tsx`
- Use it on:
  - Home: `src/app/(student)/dashboard/page.tsx`
  - Goals: `src/app/(student)/goals/page.tsx`
  - Learning: `src/app/(student)/learning/page.tsx`
  - Portfolio: `src/app/(student)/portfolio/page.tsx`
  - Career: `src/app/(student)/career/page.tsx`
- Update `src/app/(student)/welcome/WelcomeFlow.tsx` so the final step points students into the employment path instead of presenting the dashboard as a vague exploration space.
- Update `src/lib/chat/commands.ts` to expose Sage actions for:
  - Set a goal
  - Plan my week
  - Build my resume
  - Add portfolio proof
  - Analyze a job
  - Practice interview answers

Possible shape:

```ts
type PathStepKey =
  | "discover"
  | "goal"
  | "learn"
  | "prove"
  | "prepare"
  | "apply"
  | "followUp";

type PathStepState = "locked" | "available" | "active" | "complete" | "blocked";
```

Acceptance criteria:

- A student can see the employment path from Home without opening multiple pages.
- The current step is visually obvious.
- The journey component works on mobile and desktop.
- Existing nav behavior is preserved.
- No schema migration is required in this phase.

### Phase 2: Create One Shared Next Step

Goal: Replace fragmented next-action logic with one shared student next-step source.

Suggested implementation:

- Add a shared resolver, for example:
  - `src/lib/student-next-step.ts`
  - or `src/lib/progression/student-next-step.ts`
- Inputs should include the data already used by Home, Goals, Learning, Portfolio, Career, alerts, and tasks:
  - orientation/progression state
  - confirmed goals
  - active monthly/weekly/task goals
  - assigned `GoalResourceLink` records
  - portfolio/resume state
  - saved jobs/application status
  - student tasks and alerts
- Use the resolver in:
  - `AmbientPanels`
  - `GoalsPageClient` next-best action
  - Learning empty/current-plan states
  - Portfolio empty/current-proof states
  - Career saved-job/application states

Acceptance criteria:

- Each main student page points to the same primary next action.
- The next step includes a plain-language reason: "This helps you get ready for [job/path] because..."
- If the student is blocked, the next step points to Sage, advising, or a concrete support action.
- Add focused unit tests for next-step priority.

### Phase 3: Make Evidence First-Class

Goal: Let students and teachers see actual proof connected to goals and assigned resources.

Current model notes:

- `GoalResourceLink` exists and supports resource types such as platform, document, form, certification, orientation, portfolio_task, and career_step.
- `PortfolioItem` does not currently link directly to a `Goal` or `GoalResourceLink`.
- `FileUpload` has category/classification fields but does not directly link to a `Goal` or `GoalResourceLink`.
- `academic-kpi.ts` currently treats resource progress as a proxy for evidence.

Recommended data approach:

- Prefer a `GoalEvidence` model if review lifecycle matters:
  - `id`
  - `studentId`
  - `goalId`
  - `goalResourceLinkId`
  - `portfolioItemId`
  - `fileUploadId`
  - `evidenceType`
  - `status`: submitted, verified, needs_revision, rejected
  - `reviewedBy`
  - `reviewedAt`
  - `feedback`
  - timestamps
- Simpler alternative: add optional `goalId` and `goalResourceLinkId` to `PortfolioItem` and `FileUpload`.
- If schema changes are made, add a Prisma migration and run `npm run prisma:generate`.

UI/API tasks:

- Let students attach proof from Portfolio, Files/Documents, Goals, and Learning.
- Show "Proof needed" and "Proof submitted" on goal-resource assignments.
- Let teachers verify or request revision if a teacher review flow already exists nearby.
- Update KPIs to count real evidence, not only resource link status.

Acceptance criteria:

- A student can attach a file or portfolio item to a goal/resource assignment.
- The goal page shows proof status.
- The portfolio page shows what goal each proof item supports.
- KPI evidence counts use the new evidence relationship.

### Phase 4: Turn Prior Experience Into Employment Story

Goal: Make adult learners' prior experience visible and useful.

Implementation targets:

- Use `CareerDiscovery` data from `prisma/schema.prisma`.
- Add "Experience I already bring" and "Skills this proves" surfaces in Portfolio and Career.
- Add Sage actions that transform experience into:
  - resume bullet
  - portfolio proof idea
  - interview STAR story
  - job-match strength
- Ensure Sage language respects adult learners and avoids treating them as beginners by default.

Acceptance criteria:

- Students see their existing strengths connected to the target job path.
- Resume Builder can start from prior experience, not only uploaded resumes.
- Career job-match cards explain matches using skills, experience, certifications, and proof.

### Phase 5: Build the Job-Search Cockpit

Goal: Make Career the place where students move from preparation to applications.

Implementation targets:

- In `CareerHub`, make saved jobs/action pipeline more explicit:
  - saved
  - match analyzed
  - resume tailored
  - cover letter drafted
  - applied
  - interview prep
  - follow-up
- Surface Sage actions on each saved job:
  - Analyze this job
  - Tailor my resume
  - Draft cover letter
  - Practice interview
  - Update application status
- Home next step should point to the job-search cockpit once the student has enough readiness signals, such as a confirmed goal, proof item, and resume.

Acceptance criteria:

- Saved jobs always show a next action.
- The student can tell what is missing before applying.
- Job search actions reuse existing Sage tools where possible.

### Phase 6: Measurement and Teacher Loop

Goal: Measure whether the workflow is moving students toward employment.

Suggested metrics:

- Time to first Sage conversation.
- Time to confirmed career goal.
- Time to first assigned learning action.
- Time to first submitted proof.
- Time to resume created or updated.
- Time to first saved job.
- Time to first application submitted.
- Percent of active students with:
  - confirmed goal
  - active plan
  - assigned resource
  - proof artifact
  - resume
  - portfolio item
  - saved job
  - application status
- Teacher response time from alert to action.
- Student usability check: within 3 seconds, can the student state their path and next action?

Implementation targets:

- Extend `src/lib/academic-kpi.ts` as evidence/job-search data becomes reliable.
- Consider supplementing `src/lib/progression/readiness-score.ts` with a separate Job Readiness panel instead of overloading the existing score.
- Make teacher dashboard queues reflect stalled proof, stale goals, and job-search blockers.

## Design Requirements

- Keep the first screen useful. Do not add a marketing-style landing page.
- Use restrained, work-focused UI. The student is an adult learner preparing for employment.
- Plain language matters. Avoid jargon where possible.
- On every major student surface, answer "what do I do next?"
- Connect actions to employment outcomes. Every goal/resource/proof/action should have a visible "why this matters for work" where space allows.
- Maintain WCAG AA and low-literacy friendliness from `.impeccable.md`.
- Avoid childish gamification. Progress can be encouraging without feeling juvenile.

## Testing and Verification

Run checks appropriate to the phase:

- Always run `npm run lint` and `npm run typecheck` after TypeScript/UI changes.
- Run focused tests for new resolver logic.
- Run `npm run build` before handing off larger UI or route changes.
- If schema changes are made:
  - create a Prisma migration
  - run `npm run prisma:generate`
  - run relevant API/model tests
- For visible frontend changes, inspect desktop and mobile layouts in the browser and verify text does not overlap.

## Definition of Done

The redesign is successful when a student can open VisionQuest and understand:

- the employment path they are on
- the next concrete action
- how today's action helps with a job
- what proof they have collected
- what is missing before they apply
- how Sage or staff can help when they are stuck

