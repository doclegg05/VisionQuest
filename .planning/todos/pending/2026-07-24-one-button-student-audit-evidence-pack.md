---
created: 2026-07-24T13:07:12.539Z
title: One-button student audit evidence pack
area: compliance
files:
  - src/app/api/teacher/export/route.ts
  - src/lib/forms/export.ts
  - src/lib/audit.ts
  - .planning/research/2026-07-24-assessment-round-trips.md
---

## Problem

Instructors/admins need to satisfy unscheduled audits with a complete student evidence package: demographics and enrollment, progress/outcomes, official numbered forms, portfolio artifacts, certifications, and assessment results (including future Interest Profiler / Career Discovery formal scores). Today VisionQuest has partial exports (e.g. classroom CSV via `teacher.export.csv`, form-template export, grant KPI CSV) but **no one-button, per-student or cohort “audit pack”** that assembles everything auditors expect in official-form format.

Without that, staff scramble across screens; assessment features that only update chat-facing Career DNA will not leave an auditor-ready paper trail.

## Solution

TBD — needs dedicated research before build. Likely scope:

1. **Inventory** which official SPOKES/WIOA/AE forms (with form numbers) auditors require vs what VisionQuest already stores or can render.
2. **Define an Audit Evidence Pack** artifact (PDF and/or ZIP): student record summary + progress timeline + completed forms (numbered) + portfolio snapshot + assessment score reports with provenance (instrument, date, source).
3. **One-button UX** for teacher/admin on student detail (and optionally classroom/cohort): generate pack, download, log `AuditLog` who/when/why.
4. **Storage rules** for future assessments: immutable or versioned score snapshots suitable for reprint years later — not only live `CareerDiscovery` last-write-wins fields.
5. Align with existing surfaces: [`src/app/api/teacher/export/route.ts`](../../../src/app/api/teacher/export/route.ts), [`src/lib/forms/export.ts`](../../../src/lib/forms/export.ts), [`src/lib/audit.ts`](../../../src/lib/audit.ts) (`StudentViewSurface` already includes `"export"`).

**Depends on / informs:** Interest Profiler / assessment round-trips should write **audit-stable records** (source, instrument, assessedAt, optional score report PDF) — see research brief § implications. Sequencing recommendation lives in that brief and the reply that captured this todo.

## Next step when picked up

Run a research brief (mirror assessment round-trips): auditor checklist + form-number catalog + gap map vs VQ data model + pack format decision — then plan implementation.
