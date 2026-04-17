# Phase 3 — Program Badges + Teacher Multi-Class Toggle

**Date:** 2026-04-17
**Goal:** Surface program context visually (badges) and give multi-class teachers a fast class switcher. Lightweight UI phase on top of Phases 1–2.
**Target branch:** `phase-3-ui` (off `main`; rebases onto Phases 1 and 2 once merged)
**Depends on:** Phase 1 (programType on Class)
**Estimated duration:** 1 week

---

## Scope

**In:**
1. Program-type badge component, used consistently wherever a student or class is shown in staff-facing UI.
2. `ClassContext` switcher in staff page headers — persistent via URL param + localStorage, default "All classes."
3. Class filter wiring through `InterventionQueuePanel` and `ClassOverview` using existing `buildManagedStudentWhere({ classId })`.
4. Badge-consumption sites: intervention queue rows, StudentDetail header, class roster rows, class cards.
5. A11y-compliant badges (label + icon, not color-only).

**Out:**
- Student-facing badges (not needed — student already knows their classroom)
- Coordinator / CDC-specific filters (Phase 5+)
- Bulk-action affordances (Phase 6)
- Re-theming class-overview layouts

---

## Verified premises

| Claim | Evidence |
|---|---|
| `buildManagedStudentWhere` already accepts `{ classId }` option | `src/lib/classroom.ts:26-62` |
| `InterventionQueuePanel` currently fetches cross-class, no filter | `src/components/teacher/InterventionQueuePanel.tsx` (no class-filter code path) |
| StudentDetail tabs render student header | `src/components/teacher/student-detail/OverviewTab.tsx:74` |
| Existing urgency pills use `bg-[var(...)] text-[var(...)]` tokens | `InterventionQueuePanel.tsx:24-28` |
| NavBar has staff sidebar section where a global switcher could live | `src/components/ui/NavBar.tsx:24-75` |
| Phase 1 adds `SpokesClass.programType` — badges read this field | `docs/superpowers/plans/2026-04-17-phase-1-schema.md` |

---

## Design decisions

### Decision 1 — Single `<ProgramBadge programType="..." />` component

One reusable component. Every consumer imports the same thing. Variants via size prop (`sm` | `md`), not separate components.

```tsx
// src/components/ui/ProgramBadge.tsx
interface ProgramBadgeProps {
  programType: ProgramType;
  size?: "sm" | "md";
  className?: string;
}
```

Label copy:
- `spokes` → "SPOKES"
- `adult_ed` → "AE"
- `ietp` → "IETP"

### Decision 2 — Color tokens defined in globals; each program gets a pair (bg + text)

New CSS variables in `src/app/globals.css`:

```css
--program-spokes-bg: rgba(15,154,146,0.12);
--program-spokes-text: var(--accent-secondary);
--program-ae-bg: rgba(109,40,217,0.12);
--program-ae-text: rgb(91,33,182);
--program-ietp-bg: rgba(234,88,12,0.12);
--program-ietp-text: rgb(194,65,12);
```

Light/dark variants if the existing theme system uses them (check; match the existing urgency pill pattern).

### Decision 3 — Badges display label + icon, not color alone

WCAG 2.1 — color is not the sole carrier. Each badge renders an icon + text label. Icon picks:
- SPOKES: `Briefcase` (Phosphor)
- AE: `GraduationCap`
- IETP: `Wrench`

### Decision 4 — Class-context switcher is a URL-first, localStorage-fallback primitive

Signature:
```tsx
// src/components/teacher/ClassContextSwitcher.tsx
export function ClassContextSwitcher(): JSX.Element | null;
```

Behavior:
- Reads `?classId=` from URL.
- Falls back to `localStorage["teacher:activeClassId"]`.
- Default when neither present: `"all"` (show cross-class views).
- Only renders if the current user manages 2+ active classes; hidden for single-class teachers.
- Selecting a class updates URL and localStorage simultaneously.
- Selecting "All classes" clears both.

Rationale: URL-first makes views shareable/bookmarkable (a coordinator can send a link "look at class X"); localStorage preserves preference across sessions.

### Decision 5 — Filter propagation uses existing `buildManagedStudentWhere` plumbing

No new API shapes. `/api/teacher/intervention-queue` and `/api/teacher/class-overview` already receive a session; they accept an optional `classId` query param. When present, they forward it to `buildManagedStudentWhere({ classId })`. When absent, cross-class behavior (current default) is preserved.

Client components read `classId` from the URL and append it to the fetch URL.

### Decision 6 — Switcher lives in page header, not global NavBar

Rationale:
- A global switcher in the sidebar persists across student-facing pages where it has no meaning.
- Per-page header scoping keeps intent local: switch class context ON the view that cares about it.
- Pages that need it: `/teacher` (intervention queue + class overview), `/teacher/classes` (optional), `/teacher/manage` (optional — program setup is global).
- Pages that don't: student detail (already class-scoped), stubs, admin-only pages.

### Decision 7 — Student-facing UI gets zero badge treatment

Students see their own program context via Sage's tone and goals (Phase 2). Adding a "You're in SPOKES" badge on the student dashboard is noise. Keep the student UX clean.

---

## Schema migration

None. Phase 3 is UI on top of Phase 1's schema.

---

## Code changes

### 1. `src/components/ui/ProgramBadge.tsx` (new)

Small focused component. Exports default + named variant `<ProgramBadgeCompact />` for tight spaces (icon-only with aria-label).

### 2. `src/app/globals.css`

Add program color tokens (Decision 2). Mirror the urgency token pattern.

### 3. `src/components/teacher/ClassContextSwitcher.tsx` (new)

Dropdown or segmented control. Fetches classes via a new `/api/teacher/classes?mine=true` helper or reuses existing class list endpoint. Uses Next.js `useRouter` + `useSearchParams` to update URL on change.

Hidden for:
- Users with <2 active classes
- Student sessions
- Admin sessions (admin sees everything; a class filter is still useful but Phase 3 scopes to teacher only — admin gets it in Phase 5 with coordinator dashboard)

### 4. `src/app/(teacher)/teacher/page.tsx` and related server components

- Read `classId` from `searchParams`.
- Pass it to `getTeacherHomeData(session, { classId })`.
- Wrap `<InterventionQueuePanel />` and `<ClassOverview />` with the `<ClassContextSwitcher />` at the page top.

### 5. `src/lib/teacher/dashboard.ts`

- `getTeacherHomeData` accepts optional `{ classId }` and threads it to `buildManagedStudentWhere`.
- Existing shape preserved for callers that don't pass `classId`.

### 6. `src/components/teacher/InterventionQueuePanel.tsx`

- Render `<ProgramBadge />` next to each queue row's student name.
- Data fetcher appends `classId` query param when set.

### 7. `src/components/teacher/student-detail/OverviewTab.tsx` (and parent header)

- Add `<ProgramBadge />` next to the student name in the header region (around line 74).

### 8. `src/components/teacher/ClassRosterManager.tsx`

- Each class row shows a `<ProgramBadge />` on its meta line.
- When students are expanded within a class, student rows also show a badge (derived from class).

### 9. API route changes

- `/api/teacher/intervention-queue/route.ts` — accept `classId` query param (Zod validation), pass through.
- `/api/teacher/class-overview/route.ts` — same.
- `/api/teacher/classes/mine/route.ts` (new or extension) — returns classes the current teacher instructs, for the switcher dropdown.

### 10. `src/lib/program-type.ts` (Phase 1)

Add a helper for UI consumers:

```ts
export const PROGRAM_LABELS: Record<ProgramType, string> = {
  spokes: "SPOKES",
  adult_ed: "AE",
  ietp: "IETP",
};

export const PROGRAM_FULL_NAMES: Record<ProgramType, string> = {
  spokes: "SPOKES",
  adult_ed: "Adult Education",
  ietp: "IETP",
};
```

Used by `<ProgramBadge />` and by `aria-label`s.

---

## Tests

New: `tests/components/ProgramBadge.test.tsx`
- Renders correct label for each program type
- Includes `aria-label` with full name
- Icon is `aria-hidden`

New: `tests/components/ClassContextSwitcher.test.tsx`
- Hidden when user has <2 managed classes
- Renders options matching managed classes + "All classes"
- Updates URL and localStorage on selection
- Reads URL param on mount, falls back to localStorage
- Clears localStorage when "All classes" selected

Extended: `tests/api/intervention-queue.test.ts`
- Without `classId`: returns students across all managed classes (unchanged)
- With valid `classId`: returns only students in that class
- With `classId` teacher doesn't manage: 403
- With invalid `classId` format: 400

Extended: `tests/teacher/dashboard.test.ts`
- `getTeacherHomeData({ classId })` scopes results correctly

---

## UAT

1. Seed: create one SPOKES class and one AE class; enroll 2 students in each under one test teacher account.
2. Log in as test teacher → `/teacher` shows intervention queue with 4 students, each with correct program badge.
3. Class switcher visible (2+ classes); select SPOKES class → queue narrows to 2 students.
4. URL updates to `?classId=<id>`. Refresh → filter persists.
5. Click "All classes" → URL param clears, queue returns to 4.
6. Open StudentDetail for an AE student → "AE" badge appears in header.
7. Open `/teacher/classes` → each class row shows its program badge.
8. Reassign an AE student to the SPOKES class (Phase 1 flow) → badge flips immediately upon reload.
9. Log in as teacher with only 1 active class → switcher not rendered (single-class teacher).
10. Log in as student → no badges anywhere in student-facing UI.

---

## Accessibility

- Badge carries role="status" or serves as inline text; `aria-label` has full program name.
- Icons marked `aria-hidden="true"`.
- Color contrast: verify bg/text pairs meet 4.5:1 (the existing theme-card tokens do; new tokens must too).
- Switcher: native `<select>` for mobile + keyboard-first; wrapping visual treatment purely cosmetic.
- Focus states visible on all interactive targets.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Switcher clutter if a teacher has many classes | Switcher collapses to a searchable dropdown if >6 classes; pre-emptive, not Phase 3 blocker |
| URL param abuse (teacher inspects another teacher's class by guessing classId) | Server-side `buildManagedStudentWhere` already verifies instructorship; bad classId returns empty results, not other teachers' data |
| Badge color tokens clash with existing theme | Pick tones distinct from urgency pills; spot-check in both light/dark modes during UAT |
| localStorage out of sync with URL (stale classId) | On mount, URL takes precedence; localStorage only used when URL absent. Single source of truth = URL. |
| Student accidentally sees teacher switcher | Switcher renders `null` for non-staff sessions; covered by component test |

---

## Commit sequence

1. `feat(ui): ProgramBadge component + color tokens`
2. `feat(lib): PROGRAM_LABELS and PROGRAM_FULL_NAMES helpers`
3. `feat(teacher): render program badges in intervention queue`
4. `feat(teacher): render program badges in StudentDetail header + class roster`
5. `feat(api): classId query param on intervention-queue and class-overview routes`
6. `feat(teacher): ClassContextSwitcher component`
7. `feat(teacher): wire ClassContextSwitcher into /teacher page`
8. `test(ui): program badge + class switcher coverage`

Each commit: `npx eslint .` + `npm test` clean.

---

## Definition of done

- [ ] Badges render everywhere listed in Code Changes
- [ ] Switcher renders only for 2+ class teachers
- [ ] Class filter works end-to-end (URL → fetch → results)
- [ ] WCAG 2.1 contrast verified on badge colors (light + dark)
- [ ] No student-facing UI changes
- [ ] Full test suite + lint pass

---

## What this unlocks

- Teachers can triage mixed-program classrooms at a glance.
- Multi-class teachers have a fast switcher, preparing the app for 11-classroom rollout.
- Phase 4 (Forms hub) has a visual convention for "which program does this form belong to."
- Phase 5 (Coordinator dashboard) inherits a badge vocabulary for regional views.
