# Phase 5 — Coordinator Role + Regional Dashboard

**Date:** 2026-04-17
**Goal:** Give Regional Coordinators a dedicated workspace: cross-classroom visibility, instructor metrics, grant-aligned rollups, and funder-ready exports. Wire coordinator permissions into the existing RBAC system.
**Target branch:** `phase-5-coordinator` (off `main`; rebases onto prior phases)
**Depends on:** Phase 1 (roles exist), Phase 3 (program badges), Phase 4 (forms data to roll up)
**Estimated duration:** 2 weeks

---

## Scope

**In:**
1. `Region` model + coordinator-region assignment, class-region assignment.
2. Coordinator permission set wired into existing RBAC tables (`Role` / `RolePermission` / `Permission`).
3. Coordinator home: `/coordinator` — regional overview, class performance, instructor metrics, form rollups.
4. Grant targets: simple entry + actuals tracking (no accounting integration).
5. Funder-ready CSV/PDF exports for monthly and grant-cycle reporting.
6. Read-only scope — coordinator sees but does not manage individual students (teacher remit).

**Out:**
- CDC-specific workspace (Phase 6+)
- Multi-region hierarchies, sub-regions, district tiers
- External accounting / ERP integration
- Real-time streaming dashboards — rollups refresh on load/request
- Coordinator impersonation of teachers or students

---

## Verified premises

| Claim | Evidence |
|---|---|
| RBAC tables exist with enforcement path | `src/lib/rbac.ts:1-50`, `prisma/schema.prisma:1202-1241` |
| Phase 1 seeds `coordinator` role | `docs/superpowers/plans/2026-04-17-phase-1-schema.md` — Decision 3 |
| Phase 1 creates stub `/coordinator` page | Same doc — Code change 2 |
| `SpokesClass` has no region concept today | `prisma/schema.prisma:463-484` |
| `FormResponse` provides structured data for rollups | Phase 4 plan |
| Existing `AuditLog` captures actor activity | `prisma/schema.prisma:785-798` |

---

## Design decisions

### Decision 1 — `Region` is a lightweight model, not a hierarchy

```prisma
model Region {
  id          String   @id @default(cuid())
  name        String
  code        String   @unique
  description String?
  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  coordinators RegionCoordinator[]
  classes      SpokesClass[]

  @@schema("visionquest")
}

model RegionCoordinator {
  regionId      String
  coordinatorId String
  assignedAt    DateTime @default(now())

  region      Region  @relation(fields: [regionId], references: [id], onDelete: Cascade)
  coordinator Student @relation(fields: [coordinatorId], references: [id], onDelete: Cascade)

  @@id([regionId, coordinatorId])
  @@schema("visionquest")
}
```

`SpokesClass` gains optional `regionId`. One coordinator can oversee multiple regions; one region can have multiple coordinators; one class belongs to one region (nullable for grandfathering).

No nesting, no territories-within-regions. If the real org needs sub-regions later, add then.

### Decision 2 — Coordinator permissions modeled in RBAC tables, not hardcoded

Seed the `Permission` table with coordinator-relevant keys:
- `coordinator.dashboard.view`
- `coordinator.class.view.region` — view classes in assigned regions
- `coordinator.student.view.region` — view student rollup data (not full detail) in region
- `coordinator.forms.export` — CSV export
- `coordinator.grant.view`
- `coordinator.grant.edit` — set targets; no actuals override (actuals derived)
- `coordinator.instructor.metrics.view`

Associate these with the `coordinator` role via `RolePermission`. Enforce via `hasPermission(session, key)` helper (build on `rbac.ts:44`).

**Do NOT** extend coordinator permissions into `students.write.*` or `classes.manage.*`. Coordinator is read-heavy by design.

### Decision 3 — Admin inherits coordinator permissions by default

Admin is a superset. When seeding, grant all `coordinator.*` permissions to admin too. Existing admin checks (`session.role === "admin"`) continue to work; new coordinator checks use RBAC and naturally admit admin.

### Decision 4 — Grant tracking: `GrantGoal` + derived actuals

```prisma
model GrantGoal {
  id            String    @id @default(cuid())
  regionId      String
  programType   String    // spokes | adult_ed | ietp | "all"
  metric        String    // "enrollments" | "certifications" | "placements" | "ged_earned" | custom
  targetValue   Float
  periodStart   DateTime
  periodEnd     DateTime
  notes         String?   @db.Text
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  region  Region  @relation(fields: [regionId], references: [id], onDelete: Cascade)

  @@index([regionId, periodStart])
  @@schema("visionquest")
}
```

Actuals derived at query time from:
- `enrollments` → count(StudentClassEnrollment where status=active, class.regionId=X, class.programType matches)
- `certifications` → count(Certification where status=completed, student region-scoped)
- `placements` → count(JobApplication where status=placed) — assuming existing placement tracking
- `ged_earned` → new metric; may require a student flag added in Phase 5 (tbd if time permits, else later)
- custom → coordinator enters actuals manually

### Decision 5 — Instructor metrics: four headline numbers, no deep analytics

Per-instructor:
1. **Active students** — enrollments where instructor is assigned + student is active
2. **Intervention queue response time** — avg days from alert creation to status=resolved (from `StudentAlert`)
3. **Certification pass rate** — completed / attempted (last 90 days, by default)
4. **Form completion rate** — submitted+reviewed / assigned (from Phase 4 data)

One card per instructor on the coordinator dashboard. Click → drill into that instructor's class list (read-only view).

### Decision 6 — Reports: CSV first, PDF opt-in

**CSV exports** (fast, standards-compliant):
- Monthly enrollment / completion / placement rollup per region
- Grant-goal progress snapshot
- Form response exports (inherited from Phase 4)

**PDF report** (single, template-driven):
- "Funder monthly summary" — region name, period, all 4 metric categories, instructor list, narrative field
- Generated via a server-side template (react-pdf or similar); one template only in MVP
- Coordinator fills narrative field in a form before generating

Skip PDF if timeline is tight — CSV is the must-have.

### Decision 7 — Coordinator dashboard layout

`/coordinator` page sections (top to bottom):
1. **Region selector** (if coordinator has multiple regions)
2. **Headline metrics card row** — active students, certifications this month, placements, GED earned
3. **Grant progress** — targets vs actuals, color-coded on-track / at-risk / behind
4. **Instructor performance grid** — one card per instructor in region
5. **Form rollups** — list of templates with response counts + quick CSV links
6. **Recent alerts** — high-severity alerts aggregated across region (read-only link to detail)
7. **Quick actions** — "Export monthly report", "Set grant target", "Add class to region"

No intervention queue for coordinator — that's teacher work. If a coordinator needs to triage students, they contact the teacher.

### Decision 8 — Region assignment happens at class creation, editable after

New class create/update form includes a `regionId` dropdown (admin/coordinator populate it). Existing classes remain unregioned until someone edits them; rollups handle `regionId IS NULL` by excluding (with a "N unregioned classes" callout at the top of the dashboard so it doesn't silently hide data).

---

## Schema migration

Fields + models above. Also add:

```diff
 model SpokesClass {
   ...
+  regionId    String?

+  region      Region? @relation(fields: [regionId], references: [id], onDelete: SetNull)
   ...
+  @@index([regionId, status])
 }
```

Migration name: `add_region_and_grant_tracking`

Seed migration: populate Permission table rows + RolePermission assignments for coordinator.

---

## Code changes

### Server

1. `src/lib/region.ts` (new) — region resolution helpers, "what regions does this coordinator oversee", "what classes are in this region"
2. `src/lib/grant-metrics.ts` (new) — compute actuals for each metric; expose `getRegionRollup(regionId, period)`
3. `src/lib/instructor-metrics.ts` (new) — per-instructor aggregations
4. `src/lib/rbac.ts` — extend `hasPermission` helper; add `coordinator.*` permission keys

### API

5. `src/app/api/coordinator/regions/route.ts` — list regions accessible to current coordinator
6. `src/app/api/coordinator/rollup/[regionId]/route.ts` — GET rollup data for a region
7. `src/app/api/coordinator/grant-goals/**` — CRUD for `GrantGoal`
8. `src/app/api/coordinator/reports/monthly/[regionId]/route.ts` — CSV download
9. `src/app/api/admin/regions/**` — admin-only region + coordinator assignment CRUD
10. Extend `src/app/api/teacher/classes/**` to accept `regionId` on create/update

### UI

11. `src/app/(coordinator)/layout.tsx` — role-gated shell (replaces Phase 1 stub)
12. `src/app/(coordinator)/coordinator/page.tsx` — dashboard
13. `src/components/coordinator/RegionRollupCard.tsx`
14. `src/components/coordinator/GrantProgressPanel.tsx`
15. `src/components/coordinator/InstructorGrid.tsx`
16. `src/components/coordinator/FormRollupList.tsx`
17. `src/components/coordinator/MonthlyReportExporter.tsx`

NavBar updates: add `COORDINATOR_ITEMS` alongside `STAFF_ITEMS` and `ADMIN_ITEMS`; coordinator session sees coordinator nav.

---

## Tests

- **Permissions:**
  - Coordinator with region A cannot see region B data
  - Coordinator cannot write to StudentTask / ClassRequirement / Student
  - Admin inherits all coordinator permissions
  - Teacher cannot access `/coordinator` routes (403)
- **Metrics correctness:**
  - Enrollment count matches raw Prisma query on the same window
  - Certification pass rate handles zero-attempt case (returns null, not NaN/Infinity)
  - Actuals snapshot uses period bounds inclusively on start, exclusively on end (document this)
- **Region assignment:**
  - Classes with null regionId don't appear in rollups but are counted in "unregioned" callout
  - Deleting a region (SetNull) retains class data
- **Export:**
  - CSV roundtrips through Excel + Google Sheets without corruption
  - Monthly export of a 500-student region completes in <10 seconds
  - PDF export (if shipped) matches the template and fills in narrative

---

## UAT

1. Admin creates two regions: "North" and "South."
2. Admin assigns 3 classes to North, 2 to South.
3. Admin creates a `coordinator` user and assigns them to North region.
4. Log in as coordinator → `/coordinator` loads, region selector shows North only.
5. Dashboard shows correct enrollment count across the 3 North classes; South classes invisible.
6. Coordinator sets a grant target for North: "15 certifications this month."
7. Seed test data so actual certification count = 8 → grant progress card shows "8 / 15 — on track" (or "at risk" per threshold).
8. Instructor grid lists 3 instructors (one per North class) with correct active-student counts.
9. Coordinator clicks "Monthly report CSV" → downloads a 7-column CSV, opens cleanly in Excel.
10. Coordinator attempts to visit a South class via URL → 403.
11. Log in as admin → inherits coordinator dashboard; can see both regions.
12. Log in as regular teacher → no coordinator nav items; `/coordinator` redirects.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| RBAC seeding inconsistency between dev/prod | Seed migration is part of the schema migration; `hasSeededRolePermissions()` already defensive |
| Dashboard queries slow with many students | Use indexed aggregation queries; if >500ms, add summary tables in a later pass |
| Coordinator assigned multiple regions but UX assumes one | Region selector dropdown always rendered; defaults to first assigned region |
| Admin-only permissions leak to coordinator via copy-paste | Coordinator permission keys all prefixed `coordinator.*`; don't overlap with `admin.*` |
| Grant period semantics ambiguous (month vs fiscal) | Store `periodStart`/`periodEnd` explicitly on `GrantGoal`; UI supplies presets (monthly, quarterly, grant-cycle) |
| Unregioned classes silently missing from rollups | "N unregioned classes — click to assign" callout at top of dashboard |
| CDC confusion — they're a separate role that isn't addressed in Phase 5 | Phase 5 ships with CDC still routed to the Phase 1 stub; CDC-specific dashboard explicitly deferred |

---

## Commit sequence

1. `feat(schema): add Region, RegionCoordinator, GrantGoal; regionId on SpokesClass`
2. `feat(schema): seed coordinator permissions in Permission + RolePermission tables`
3. `feat(lib): region + grant-metrics + instructor-metrics helpers`
4. `feat(api): coordinator rollup + regions + grant goals endpoints`
5. `feat(api): admin region management + class regionId on create/update`
6. `feat(coordinator): dashboard layout + region rollup card`
7. `feat(coordinator): grant progress panel + instructor grid + form rollup`
8. `feat(coordinator): monthly CSV export`
9. `feat(nav): add coordinator nav items`
10. `test(coordinator): permission + metrics + export coverage`
11. (optional) `feat(coordinator): PDF monthly report`

---

## Definition of done

- [ ] Coordinator role fully functional end-to-end (login → dashboard → export → logout)
- [ ] Admin inherits coordinator capabilities without double-coding
- [ ] Coordinator cannot modify student / class / task data (enforced by tests)
- [ ] CSV export produces usable data for funder reporting
- [ ] Region assignment editable by admin
- [ ] Full test suite + lint + prisma validate pass

---

## What this unlocks

- **Grant-cycle reporting** stops being a manual spreadsheet job.
- **Multi-classroom deployment** (target: 11 by 3 months) has a proper oversight layer.
- **Scaling pressure** on the single-admin model relieved — admin ≠ coordinator anymore.
- **Phase 6 (daily roster + polish)** can assume coordinator visibility exists and focus on teacher-level improvements.
