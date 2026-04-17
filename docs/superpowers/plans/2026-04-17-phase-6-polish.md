# Phase 6 — Daily Roster, StudentDetail Reorg, Discoverability

**Date:** 2026-04-17
**Goal:** Final polish phase before full 11-classroom rollout. Replace intervention-queue-as-primary with a daily roster for in-class orchestration, reorganize StudentDetail around coaching workflow, close the Sage and Career DNA discoverability gaps.
**Target branch:** `phase-6-polish` (off `main`; rebases onto prior phases)
**Depends on:** Phase 1 + Phase 3 (badges, multi-class context), Phase 4 (forms), Phase 5 (regions)
**Estimated duration:** 1–2 weeks

---

## Scope

**In:**
1. "Today" roster view on `/teacher` alongside the existing intervention queue.
2. StudentDetail tab reorg: Coach / Progress / Admin (from the verified-findings analysis).
3. Fix broken cross-tab anchor links identified earlier.
4. Add Sage entry to the desktop sidebar (keep mobile FAB).
5. Surface `/profile` (Career DNA) from the `/career` page.
6. General tab-order + empty-state polish discovered during prior phases.

**Out:**
- Attendance tracking (Daily roster reads existing signals — login, tasks, conversations; formal attendance can be a later feature)
- CDC-specific workspace (separate phase)
- Full notification center / alerting overhaul
- Redesigning the student dashboard hero

---

## Verified premises

| Claim | Evidence |
|---|---|
| StudentDetail has 4 tabs: Overview / Goals & Plan / Progress / Operations | `src/components/teacher/student-detail/StudentDetailTabs.tsx:19-24` |
| Operations tab contains Case Notes + Appointments + Follow-Up Tasks (coaching, not admin) | `OperationsTab.tsx:118,211,405,550` |
| GoalsPlanTab has buttons linking to anchors in ProgressTab that can't reach across tabs | `GoalsPlanTab.tsx:60-66` vs `ProgressTab.tsx:52,154` |
| Sage has no sidebar entry; only floating FAB on desktop | `src/components/ui/NavBar.tsx:462-481` |
| `/profile` (Career DNA) is nav-orphaned | not in `src/lib/nav-items.ts` |
| Teacher dashboard is intervention queue + class overview | `src/app/(teacher)/teacher/page.tsx:17-26` |

---

## Design decisions

### Decision 1 — Daily roster = new tab on `/teacher`, not replacement

Adding alongside the existing intervention queue, not replacing it. Rationale: small classes (7 students, like yours today) benefit from a roster view; large deployments (11 classrooms * 10 students = 110) benefit from the urgency-scored queue. Both are right at different scales. Give both.

Layout:
```
[ Today | Intervention Queue | Class Overview ]   ← tabs, new "Today" default
```

"Today" default for sessions where the active class context (from Phase 3 switcher) has a session scheduled today; falls back to Intervention Queue otherwise.

### Decision 2 — Today roster signal sources (read-only, no new schema)

No new data model. Compose from existing:
- **Presence proxy:** last login timestamp on `Student` (or most-recent `Message` from student) within past N hours
- **Active task:** highest-priority open `StudentTask` for today
- **Active learning:** most-recent `Conversation` module/stage
- **Open alerts:** `StudentAlert` with severity ≥ medium

Each row: student name + program badge + presence dot + active task title + alerts count. Click → StudentDetail.

### Decision 3 — StudentDetail reorg: Coach / Progress / Admin

Reorganize the 4 existing tabs into 3 tabs matching actual teacher workflow:

| New Tab | Contains | Moves From |
|---|---|---|
| **Coach** (default) | Case Notes, Follow-Up Tasks, Appointments, Goals list + review queue, Alerts, Motivation Trend | Overview + Goals & Plan + most of Operations |
| **Progress** | Orientation, Certification (+ Verify), Career Progress, Portfolio, Files, Conversations, Career Discovery | Progress + parts of Overview |
| **Admin** | Password reset, deactivate, archive data, Submitted Forms (PDF), account metadata | Operations leftovers |

Anchors within "Coach" tab replace the broken cross-tab links — all relevant sections are now on the same tab, so `href="#certification-review"` works where it couldn't before (because certification review moves to the Progress tab — update the anchor link accordingly, anchor scrolls to the Progress tab's section and auto-switches tabs).

### Decision 4 — Auto-switch-on-anchor for tabs

When any anchor link like `#certification-review` is clicked, determine which tab owns that anchor and switch before scrolling. Small `useEffect` on hash change; a map of `anchorId → tabKey`. Keeps cross-tab links functional.

### Decision 5 — Sage sidebar entry: dedicated primary nav item

Add Sage to `STUDENT_NAV_ITEMS` as the second item (right after Home):

```diff
 export const STUDENT_NAV_ITEMS: NavItem[] = [
   { href: "/dashboard", label: "Home", icon: House, phase: 1 },
+  { href: "/chat", label: "Sage", icon: ChatCircle, phase: 1 },
   { href: "/orientation", label: "Orientation", icon: ClipboardText, phase: 1 },
   ...
 ];
```

Keep the desktop floating FAB (quick-open mini chat from any page). The sidebar entry navigates to full `/chat`. Mobile bottom bar: unchanged (already has Sage center FAB).

This bumps Phase-3 primary nav to 8 items. Acceptable — Sage is the product, and a Phase-3 student is past the cognitive-load-sensitive phase. If research later shows it crowds the sidebar, we deprioritize a different item (candidate: `/orientation` disappears post-completion already, so peak crowding is temporary).

### Decision 6 — Career DNA surfaced inside `/career`

Don't add `/profile` to nav. Add a persistent "Your Career DNA" card on the `/career` page (top of page), linking to `/profile`. Career is the natural parent; `/profile` is the deeper dive.

Also inject a call-to-action into Sage post-discovery: "You can see your Career DNA anytime on your Career page."

### Decision 7 — Scope cuts for time

If Phase 6 runs over:
1. **Cut first:** Today-roster. Existing intervention queue works for current classroom sizes; daily roster is a scale-forward improvement.
2. **Cut second:** Auto-switch-on-anchor. Anchors can remain broken for one release if the tab reorg still ships.
3. **Protect:** Tab reorg, Sage sidebar, Career DNA surface. These fix active friction.

---

## Schema migration

None. Phase 6 is UI and component reorg.

---

## Code changes

### Teacher-side

1. `src/app/(teacher)/teacher/page.tsx` — add top-level tab switcher (Today / Intervention Queue / Class Overview)
2. `src/components/teacher/TodayRoster.tsx` (new)
3. `src/lib/teacher/today.ts` (new) — compose signals per Decision 2
4. `src/components/teacher/student-detail/StudentDetailTabs.tsx` — 4 tabs → 3 tabs
5. `src/components/teacher/student-detail/CoachTab.tsx` (new) — consolidates Overview + Goals & Plan + Operations' coaching artifacts
6. `src/components/teacher/student-detail/ProgressTab.tsx` — gains Career Discovery section from Overview
7. `src/components/teacher/student-detail/AdminTab.tsx` (new) — renames OperationsTab after moving content out
8. Delete: `OverviewTab.tsx`, `GoalsPlanTab.tsx`, `OperationsTab.tsx` (code split into new tabs; don't retain corpses)
9. `src/components/teacher/student-detail/useAnchorTabSwitch.ts` (new) — Decision 4

### Student-side

10. `src/lib/nav-items.ts` — add Sage to STUDENT_NAV_ITEMS (Decision 5)
11. `src/components/ui/NavBar.tsx` — ensure sidebar Sage entry renders correctly alongside FAB (remove FAB on `/chat` route to avoid double-rendering)
12. `src/app/(student)/career/page.tsx` — add `<CareerDnaCallout />` at top
13. `src/components/career/CareerDnaCallout.tsx` (new)

### Shared

14. Audit anchor IDs across StudentDetail; build `ANCHOR_TO_TAB_MAP` for auto-switch hook

---

## Tests

- **Today roster:**
  - Roster shows students active in last 2 hours as "present"
  - Students with open high-severity alerts show alert badge
  - Empty roster (no class session today) falls back to intervention queue
- **Tab reorg:**
  - Case Notes section now renders inside CoachTab, not OperationsTab
  - Anchor `#certification-review` navigates to Progress tab and scrolls
  - Anchor `#goal-evidence` stays on Coach tab
  - Existing cross-tab links from `GoalsPlanTab` action buttons work (regression)
- **Sage nav:**
  - Desktop sidebar includes "Sage" for student role; clicking navigates to `/chat`
  - FAB not rendered on `/chat` route
  - Mobile bottom bar unchanged (smoke test)
- **Career DNA:**
  - CareerDnaCallout renders on `/career` when career-discovery status is complete
  - Callout hidden when discovery not started

---

## UAT

1. Open `/teacher` on a test day with seeded data → "Today" tab loads by default, lists current classroom's active students.
2. Student with no activity in last 2 hours shows "away" dot; student with recent login shows "present."
3. Open a StudentDetail → default tab is now "Coach."
4. Case notes, follow-up tasks, appointments, goals, and alerts all visible on "Coach" tab without switching.
5. In Coach tab's Goals section, click "Review certification" on a review item → auto-switches to Progress tab, scrolls to certification section.
6. Open Admin tab → shows only password reset, deactivate, archive, PDF Submitted Forms. No coaching artifacts.
7. Log in as student → sidebar shows "Sage" as the second nav item.
8. Click Sage → navigates to `/chat`; floating FAB does NOT render on `/chat`.
9. Navigate to `/career` → Career DNA callout at top; click → lands on `/profile` successfully.
10. Phase-3 student (all nav items visible) → count primary nav items = 8. Layout still fits.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Tab reorg breaks existing anchors/deep links in conversations, emails, notifications | Audit across codebase; add the anchor-tab map covering every `#anchor` referenced from outside StudentDetail |
| Teachers habituated to "Operations" tab look for password reset and can't find it | Add one-time toast on first StudentDetail visit after deploy: "Tabs have been reorganized. Admin actions moved to the Admin tab." |
| Sidebar Sage entry makes Phase-3 nav too crowded | Acceptable tradeoff; monitor heatmaps post-launch. Fallback: collapse orientation into "More" once complete (already hidden today). |
| Today roster calls `lastLogin` that doesn't exist on Student | Check schema before implementation; `Student` has `mfaVerifiedAt` and `updatedAt`, may need `lastLoginAt`. If absent, derive from `Message.createdAt` most-recent per student. |
| Broken anchor fixes regress | Keep the ANCHOR_TO_TAB_MAP small and well-tested; unit-test each mapping |

---

## Commit sequence

1. `feat(teacher): Today roster data helpers`
2. `feat(teacher): Today roster UI + dashboard tab switcher`
3. `refactor(teacher): consolidate StudentDetail into Coach/Progress/Admin tabs`
4. `feat(teacher): anchor-to-tab auto-switch hook`
5. `feat(nav): add Sage to student primary nav`
6. `fix(nav): suppress Sage FAB on /chat route`
7. `feat(career): Career DNA callout on /career page`
8. `test(phase-6): coverage for roster + tab reorg + nav changes`

---

## Definition of done

- [ ] `/teacher` shows Today + Intervention Queue + Class Overview tabs
- [ ] StudentDetail has exactly 3 tabs (Coach / Progress / Admin); old tabs deleted
- [ ] Broken cross-tab anchors now work
- [ ] Sage visible in student sidebar and reachable via one click
- [ ] `/profile` surfaced from `/career`
- [ ] Full test suite + lint pass
- [ ] Manual UAT checklist verified
- [ ] No regression in mobile bottom bar

---

## What this closes out

- All ten friction findings from the verified UX review resolved
- All four priority tiers (Student / Teacher / Coordinator / CDC — last excepted) have a defensible workspace
- The 3-month deploy target is met with Phase 6 shipping at weeks 9–11
- Week 11–12 reserved for bug fixes, deployment, and stabilization across 11 classrooms
