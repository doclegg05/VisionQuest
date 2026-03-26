# Framework Application: VisionQuest

Date: March 26, 2026
Baseline: Current codebase state as of today's audit.

---

## Step 1: Question Every Requirement

### Requirements That Pass

These have a clear user, a measurable outcome, and an owner:

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

These lack a clear owner, user problem, or measurable outcome:

| Requirement | Problem |
|---|---|
| **Vision Board** | No measurable connection to goal follow-through. Inspirational but not actionable. No owner defending it. |
| **Generic file storage** | Not a student goal. Contextual uploads already exist in orientation, portfolio, and forms. |
| **Resources library** | Duplicates what orientation, learning, and goals already surface contextually. |
| **9-tab Manage dashboard** | No single owner. Mixes setup, operations, reports, and audit. Teachers can't find what they need. |
| **XP/Level gamification** | Decorates the process but doesn't change student behavior. We already removed it from readiness scoring. |
| **7 module cards on dashboard** | Duplicates the navigation sidebar. Students don't need a catalog — they need "what's next." |
| **Credly integration in Settings** | Belongs in Learning or Portfolio where the student understands why. Settings should be boring. |
| **Vision Board API route** | Supports a dead feature. |

---

## Step 2: Delete

### Delete These Pages

None. Vision Board is student-validated (favorite feature per student feedback). Files and Resources are instructor-valued for program operations. All three stay but should be restored to navigation.

**Action:** Add Vision Board, Files, and Resources back to student navigation since they are actively used.

### Delete These Redirect Pages

These exist only as redirects from old URLs. If no external links point to them, remove:

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

### Deliberate Add-Back

- Vision Board stays — students' favorite feature. Restore to nav.
- Files stays — instructor needs it for program operations. Restore to nav.
- Resources stays — instructor values it. Restore to nav.
- Keep XP and achievements as background data — just don't use them as readiness indicators

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

**Target: 7 items**

| Item | Status |
|---|---|
| Home | Keep (rename from Dashboard) |
| Sage | Keep as primary CTA, not a nav item — float it as a persistent action button |
| Goals | Keep |
| Learning | Keep (already merged Courses + Certs) |
| Career | Keep (already merged Opportunities + Events) |
| Advising | Keep (already merged Appointments + Tasks + Alerts) |
| Portfolio | Keep |
| Orientation | Merge INTO the Home suggested actions + Learning. Not a permanent destination — once done, it's dead weight in nav. |
| Settings | Keep but move to profile/avatar menu, not main nav |

**Result: 6 main nav items** (Home, Goals, Learning, Career, Advising, Portfolio) + Sage as floating action + Settings in profile menu.

### Simplify Dashboard (Home)

**Current: 8 sections + 7 module cards = very busy**

**Target: 4 sections**

1. **Mountain Progress** — readiness visualization (keep)
2. **What's Next** — merge Suggested Actions + incomplete orientation items into one prioritized list
3. **Your Progress** — XP bar + streak + recent wins (compress into one card)
4. **Advising** — next appointment + open tasks (keep, it's actionable)

**Remove from Home:**
- Module cards (navigation handles this)
- Cohort card (nice-to-have, not actionable for the student)
- Separate achievements section (fold into "Your Progress")

### Simplify Teacher Product: 4 Questions

1. **Who needs attention now?** -> Dashboard (intervention queue)
2. **What is blocking them?** -> Student Detail
3. **What should I assign or review next?** -> Student Detail
4. **What operational record needs completing?** -> Classes + Setup

### Simplify Teacher Navigation

**Current: 3 items** (Class Dashboard, Classes, Manage Content)

**Target: 3 items** (but clearer)

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

---

## Step 4: Accelerate

### Core Loops To Speed Up

**1. Goal Review Loop**
- Trigger: Goal becomes stale or unreviewed
- Target: Review in one sitting, under 5 minutes
- Current bottleneck: Teacher must navigate to Student Detail, scroll through 15 sections to find goals
- Fix: Tabbed StudentDetail puts Goals & Plan in one click. Dashboard preview shows student's perspective instantly.

**2. Orientation Completion Loop**
- Trigger: New student starts or returns to incomplete packet
- Target: Completable in one session
- Current bottleneck: Orientation is a separate nav item students may ignore after initial completion
- Fix: Surface incomplete orientation items in the Home "What's Next" section. Remove orientation as permanent nav once complete.

**3. Evidence Capture Loop**
- Trigger: Student completes learning or certification work
- Target: Proof attached in under 2 minutes
- Current bottleneck: Uploads scattered across multiple surfaces
- Fix: Keep uploads contextual — Learning page for cert evidence, Portfolio for work samples.

**4. Intervention Loop**
- Trigger: System detects stalled student
- Target: Teacher identifies top students needing help in under 5 minutes
- Current bottleneck: ClassOverview dashboard shows aggregated data but doesn't prioritize individual students
- Fix: Build the intervention queue as the primary teacher dashboard view — sorted by urgency, with one-click action.

### Compression Check

| Loop | One trigger? | One owner? | One place to act? | One next state? |
|---|---|---|---|---|
| Goal review | Yes (stale) | Yes (Goals page) | Needs work — split across pages | Yes (reviewed) |
| Orientation | Yes (incomplete) | Yes (Orientation) | Yes | Yes (complete) |
| Evidence | Yes (work done) | No — split across Learning/Portfolio | Needs consolidation | Yes (proof attached) |
| Intervention | Yes (stall detected) | No — spread across dashboard/alerts/notes | Needs one queue | Yes (action assigned) |

---

## Step 5: Automate

### Ready for Automation Now

| Process | Why Ready | Type |
|---|---|---|
| Goal stale detection | Rules are explicit, teacher decides action | Detection |
| Orientation follow-up reminders | Repetitive, trigger is clear | Mechanical |
| Appointment reminders | Already partially built (internal/appointments/reminders) | Mechanical |
| Monthly readiness rollups | Repetitive aggregation | Mechanical |

### Not Ready for Automation

| Process | Why Not |
|---|---|
| Goal creation/confirmation | Judgment-heavy counseling step |
| Pathway assignment | Suggestion is useful, auto-assignment is not |
| Student archiving | Inactivity doesn't always mean disengagement |
| BHAG completion marking | Requires human verification |

### AI Assistance (Already Implemented, Verify Quality)

| Feature | Status | Verify |
|---|---|---|
| Sage career discovery with RIASEC | Built today | Test extraction quality with real conversations |
| Sage goal extraction | Existing | Verify confidence thresholds are appropriate |
| Career cluster matching | Existing | Verify cluster scores align with student responses |

---

## Immediate Action Plan

### Do Now (Restore + Clean)

1. Restore Vision Board, Files, and Resources to student navigation
2. Remove 7 module cards from dashboard (navigation handles discovery)
3. Delete redirect-only pages (spokes, events, opportunities, courses, certifications) if no inbound links

### Do Next (Simplify)

6. Remove Orientation from main nav (surface in Home's "What's Next" instead)
7. Move Settings to profile menu
8. Make Sage a floating action button, not a nav item
9. Compress dashboard to 4 sections (Mountain, What's Next, Progress, Advising)
10. Move Credly from Settings to Portfolio

### Do After (Accelerate)

11. Build tabbed StudentDetail (Overview, Goals, Progress, Operations)
12. Build teacher intervention queue as primary dashboard
13. Surface incomplete orientation in Home's suggested actions

### Do Last (Automate)

14. Goal stale detection alerts
15. Orientation follow-up reminders
16. Monthly readiness reports
