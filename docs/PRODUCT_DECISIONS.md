# VisionQuest Product Decisions

Status: **Authoritative** — This document governs all product scope decisions.  
Updated: April 1, 2026  
Baseline: Current codebase state as of today's audit.

This document applies the 5-step product engineering framework to VisionQuest and records all resulting decisions. Where prior documents conflict with this one, this document wins.

For product context, mission, and charter, see [PRODUCT_GUIDE.md](./PRODUCT_GUIDE.md).  
For repo-specific operating rules, see [CLAUDE.md](../CLAUDE.md).

---

## The Framework

A 5-step process for building products that work. Each step must be completed in order.

1. **Question** — Is each requirement real, owned, and measurable?
2. **Delete** — Remove everything that doesn't directly serve the core loop. Add back ~10%.
3. **Simplify** — Merge duplicates, shorten navigation, one surface per job.
4. **Accelerate** — Speed up what survived. One trigger, one owner, one action.
5. **Automate** — Only stable, repeated, low-judgment processes. Manual first.

The most common mistake is jumping to Step 5. The most valuable step is usually Step 2.

### Requirement Test

Every requirement must have one named owner who can defend it with a user problem and a measurable outcome. Requirements without an owner are rejected. Planning artifacts are not approved scope until referenced by the product charter and assigned to an owner.

### Cut Rule

Cut by default if any item: duplicates another workflow, is motivational but not tied to a real user action, exists mainly because it sounded useful, creates setup burden without clear payoff, adds reporting without changing a decision, or needs a long explanation to justify its existence.

### Kill Rules

- If an acceleration effort makes the workflow faster but less trustworthy, the effort failed.
- If automation increases hidden errors, correction time, or staff distrust, turn it off.

---

## Step 1: Question Every Requirement

### Requirements That Pass

| Requirement | User Problem | Measurable Outcome |
|---|---|---|
| Career discovery via Sage | Students don't know what career to pursue | Student has confirmed career direction + cluster match |
| Goal hierarchy (BHAG -> tasks) | Students need structure to turn dreams into action | Goals set at all 5 levels |
| Orientation checklist | Program compliance requires forms completed | % orientation complete |
| Certification tracking | Students need industry credentials for employment | Certs started/earned count |
| Resume & portfolio | Students need proof of readiness for employers | Resume created, portfolio shared |
| Teacher intervention queue | Teachers need to find stalled students fast | Time to identify + act on stalled student |
| Student enrollment by instructor | Instructor controls who's in the program | Account created, student enrolled |
| Readiness score | Students and teachers need to know how close to "done" | 0-100 score with clear dimensions |

### Requirements That Fail

| Requirement | Problem |
|---|---|
| **Vision Board** | No measurable connection to goal follow-through. Inspirational but not actionable. No owner defending it. |
| **Generic file storage** | Not a student goal. Contextual uploads already exist in orientation, portfolio, and forms. |
| **Resources library** | Duplicates what orientation, learning, and goals already surface contextually. |
| **9-tab Manage dashboard** | No single owner. Mixes setup, operations, reports, and audit. Teachers can't find what they need. |
| **XP/Level gamification** | Decorates the process but doesn't change student behavior. Already removed from readiness scoring. |
| **7 module cards on dashboard** | Duplicates the navigation sidebar. Students need "what's next," not a catalog. |
| **Credly integration in Settings** | Belongs in Learning or Portfolio where the student understands why. |
| **Vision Board API route** | Supports a dead feature. |

---

## Step 2: Delete

### Delete These Redirect Pages

| Page | Redirects To | Action |
|---|---|---|
| `src/app/(student)/spokes/` | /dashboard | Delete after confirming no inbound links |
| `src/app/(student)/events/` | /career | Keep 6 months for bookmarks, then delete |
| `src/app/(student)/opportunities/` | /career | Keep 6 months, then delete |
| `src/app/(student)/courses/` | /learning | Keep 6 months, then delete |
| `src/app/(student)/certifications/` | /learning | Keep 6 months, then delete |

### Delete From Dashboard

| Item | Reason |
|---|---|
| 7 module cards section | Duplicates sidebar navigation. The dashboard should answer "what's next," not "here's everything." |

### Delete From Settings

| Item | Reason | Move To |
|---|---|---|
| Credly badge integration | Not a setting — it's a learning/portfolio action | Learning or Portfolio page |

### Delete From Active Scope

| Item | Reason |
|---|---|
| Student-facing SPOKES as a workflow | Duplicates other tabs. Keep as staff record and reporting only. |
| Full setup wizard scope | Solves a future platform problem, not the current outcome problem. Frozen as planning artifact. |
| Gamification missions, rewards, kudos | Support mechanics, not the main loop. Frozen until core loop is stable. |

### Delete Process, Not Just Features

- No planning artifact is active scope until it is referenced by the product charter and assigned to a named owner.
- Any requirement without one accountable owner is rejected.
- If a metric does not change a teacher action, product action, or reporting obligation, it should not be collected.
- One job gets one primary owner tab. Dashboards may summarize but do not become second editors.

### Deliberate Add-Back (April 1, 2026)

These items were initially cut but are retained for specific reasons:

- **Vision Board** — students' favorite feature per student feedback. Restore to nav.
- **Files** — instructors need it for program operations. Restore to nav.
- **Resources** — instructors value it. Restore to nav.
- **XP and achievements** — keep as background data, but do not use as readiness indicators.

---

## Step 3: Simplify

### Student Product: 5 Questions

The student product should answer exactly these:

1. **What direction am I pursuing?** -> Home (mountain + readiness)
2. **What should I do next?** -> Home (suggested actions) + Sage
3. **What learning path supports that?** -> Learning
4. **What proof of progress do I have?** -> Portfolio
5. **Where do I need instructor help?** -> Advising

### Simplify Student Navigation

**Current: 9 items** (Sage, Dashboard, Goals, Orientation, Learning, Career, Advising, Portfolio, Settings)

**Target: 6 main nav items** (Home, Goals, Learning, Career, Advising, Portfolio) + Sage as floating action + Settings in profile menu.

| Item | Decision |
|---|---|
| Home | Keep (rename from Dashboard) |
| Sage | Keep as persistent floating CTA, not a nav item |
| Goals | Keep |
| Learning | Keep (merges Courses + Certifications) |
| Career | Keep (merges Opportunities + Events) |
| Advising | Keep (merges Appointments + Tasks + Alerts) |
| Portfolio | Keep |
| Orientation | Merge INTO Home suggested actions + Learning. Not a permanent destination. |
| Settings | Move to profile/avatar menu, not main nav |

### Simplify Dashboard (Home)

**Current: 8 sections + 7 module cards**

**Target: 4 sections**

1. **Mountain Progress** — readiness visualization
2. **What's Next** — merge suggested actions + incomplete orientation into one prioritized list
3. **Your Progress** — XP bar + streak + recent wins (one card)
4. **Advising** — next appointment + open tasks

Remove: module cards, cohort card, separate achievements section.

### Simplify Student Surfaces

| Surface | Decision |
|---|---|
| Goals | Only full planning surface. Other pages show light contextual alignment only. |
| Learning | Merge Courses + Certifications into one destination with sections for pathway, platforms, certs, Ready to Work. |
| Career | Merge Opportunities + Events into one destination with filters for jobs, events, applications. |
| Portfolio | Owns resume, work samples, and shareable proof. Move public credential sharing here from Certifications. |
| Settings | Account and recovery only. Move Credly to Learning or Portfolio. |

### Simplify Teacher Navigation

**Current: 3 items** (Class Dashboard, Classes, Manage Content with 9 tabs)

**Target: 3 items** (clearer)

| Current | Becomes |
|---|---|
| Class Dashboard | **Students** (intervention queue focus) |
| Classes | **Classes** (keep) |
| Manage Content (9 tabs) | **Program Setup** (reduce to 4 tabs: Orientation, Learning, Career, Reports) |

### Simplify StudentDetail.tsx

**Current: 1900 lines, 15+ sections all on one page**

**Target: Tabbed layout with 4 tabs**

1. **Overview** — identity, readiness, top alerts, career discovery summary
2. **Goals & Plan** — goal tree, support planner, evidence, review queue
3. **Progress** — orientation, certifications, portfolio, conversations
4. **Operations** — forms, notes, appointments, tasks, SPOKES record

### Acceptance Standard

Simplification succeeds only if: navigation becomes shorter, page purpose becomes more obvious, the same task appears in fewer places, and users need fewer clicks to accomplish their core job.

---

## Step 4: Accelerate

Accelerate only workflows that still deserve to exist. Do not accelerate deleted scope, duplicate surfaces, or processes whose exception path is unclear.

### Compression Rules

Every accelerated workflow must follow:

1. One trigger
2. One owner
3. One primary place to act
4. One visible next state
5. One exception path

### Core Loops

#### 1. Goal Review Loop

- **Trigger:** Goal becomes stale or unreviewed
- **Owner:** Advising Owner
- **Target:** Review in one sitting, under 5 minutes
- **Speed up:** Reduce screens for review; make review state visible from Home; let instructors restate goals without hunting
- **Do not speed up:** Generating more AI drafts; collecting extra reflection prompts

#### 2. Goal-To-Pathway Assignment Loop

- **Trigger:** Student has a confirmed goal
- **Owner:** Curriculum Owner
- **Target:** Common goals matched same day; unmatched goals visible to staff within 1 business day
- **Speed up:** Show recommended pathway from confirmed goal; one-click instructor override; expose unmatched goals immediately
- **Do not speed up:** Automatic final pathway assignment without a human owner

#### 3. Orientation Completion Loop

- **Trigger:** Student starts or returns to incomplete packet
- **Owner:** Operations Owner
- **Target:** Completable in one session
- **Speed up:** One ordered checklist; each step opens the right document; completion action next to the record
- **Do not speed up:** Parallel generic file workflows

#### 4. Evidence Capture Loop

- **Trigger:** Student completes learning or certification work
- **Owner:** Operations Owner
- **Target:** Proof attached in under 2 minutes; teacher verification from one queue
- **Speed up:** Keep uploads contextual; reduce duplicate file entry; show proof status from owning workflow
- **Do not speed up:** A generic student file bucket

#### 5. Intervention Loop

- **Trigger:** System detects stalled student, overdue requirement, or missing evidence
- **Owner:** Advising Owner
- **Target:** Teacher identifies top students needing help in under 5 minutes
- **Speed up:** Prioritize queue by actionability; make alert reason obvious; keep intervention action close to alert
- **Do not speed up:** More metrics in dashboards; sending teachers into full student records for every small action

### Compression Check

| Loop | One trigger? | One owner? | One place to act? | One next state? |
|---|---|---|---|---|
| Goal review | Yes (stale) | Yes (Goals) | Needs work — split across pages | Yes (reviewed) |
| Orientation | Yes (incomplete) | Yes (Orientation) | Yes | Yes (complete) |
| Evidence | Yes (work done) | No — split across Learning/Portfolio | Needs consolidation | Yes (proof attached) |
| Intervention | Yes (stall detected) | No — spread across dashboard/alerts/notes | Needs one queue | Yes (action assigned) |

### Cycle-Time Metrics

Only these matter for now:

1. Median time from confirmed goal to approved pathway
2. Median time from completed work to proof attached
3. Median time from detected stall to teacher-assigned next action
4. Percent of orientation packets completed in one session
5. Teacher time to identify top students needing attention

### What Not To Accelerate

- Gamification experiments
- Setup wizard or platform configuration
- Student-facing SPOKES rebuild
- Broad KPI reporting before the intervention queue exists

---

## Step 5: Automate

Automate only processes that are stable, repeated, and low-judgment. This step comes last because automating a broken process produces broken results faster.

### Automation Readiness Test

A workflow is ready only if ALL are true:

1. It has one accountable owner
2. It has one source of truth
3. The manual version already works
4. The exception path is known
5. Failure is reversible
6. Automation reduces correction time, not just clicks

### Automation Sequence

**Stage 1 — Mechanical automation:**
- Reminders (goal review, appointment, orientation follow-up, overdue requirements)
- Document routing and record attachment
- Generated resume files from saved data
- Monthly rollups from trusted data

**Stage 2 — Detection automation:**
- Queue generation and prioritization (stale goals, missing evidence, overdue requirements, class inactivity)
- System surfaces the student and reason; teacher decides the intervention

**Stage 3 — Assistive AI:**
- Draft suggestions, status summaries, recommended next actions
- Ships only after Stages 1 and 2 are trustworthy

### AI May Assist With

- Drafting resume language from confirmed student facts
- Suggesting pathway matches from a human-owned catalog
- Summarizing student status for staff review
- Proposing next-step language for tasks or interventions

### AI May Not Finalize

- A student goal or commitment
- A final pathway assignment
- An archive or removal decision
- An outcome claim used for reporting

Human confirmation remains mandatory for those.

### Not Ready For Automation

| Process | Reason | Owner |
|---|---|---|
| Final goal creation/confirmation | Judgment-heavy counseling step | Advising Owner |
| Final pathway assignment | Suggestion useful, auto-assignment not | Curriculum Owner |
| Student archiving | Inactivity doesn't always mean disengagement | Operations Owner |
| Gamification expansion | Core-loop data not yet trustworthy | Product Sponsor |
| Full instructor setup automation | Future platform scope | Product Sponsor |

### Approval Standard

No automation ships without: baseline manual workflow documented, owner named, trigger and finish state defined, failure mode documented, rollback path documented, measurement plan defined.

---

## Immediate Action Plan

### Do Now (Restore + Clean)

1. Restore Vision Board, Files, and Resources to student navigation
2. Remove 7 module cards from dashboard
3. Delete redirect-only pages (spokes, events, opportunities, courses, certifications) if no inbound links

### Do Next (Simplify)

4. Remove Orientation from main nav (surface in Home's "What's Next" instead)
5. Move Settings to profile menu
6. Make Sage a floating action button, not a nav item
7. Compress dashboard to 4 sections (Mountain, What's Next, Progress, Advising)
8. Move Credly from Settings to Portfolio

### Do After (Accelerate)

9. Build tabbed StudentDetail (Overview, Goals, Progress, Operations)
10. Build teacher intervention queue as primary dashboard
11. Surface incomplete orientation in Home's suggested actions

### Do Last (Automate)

12. Goal stale detection alerts
13. Orientation follow-up reminders
14. Monthly readiness reports
