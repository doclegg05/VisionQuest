# Journal — Print All Orientation Forms (agent/orientation-print-packet-20260709)

[intake] DECISION: paper-based orientation (digital signature shelved per Britt) →
build an instructor "Print all orientation forms" packet. | REVERSIBLE: branch, unmerged.

DECISION: Packet = onboarding-category forms, derived live from FORMS (not a second
hardcoded list). | WHY: single source of truth, can't drift when forms are added.
| ALTERNATIVES: hand-curated packet list (rejected — drift risk).

DECISION: Merge real PDFs server-side into ONE inline PDF with pdf-lib. | WHY: gives the
instructor/inspector a single print job; jspdf (present) can't merge existing PDF pages.
| ALTERNATIVES: N-tab print (popup hell), ZIP download (not a print job). | REVERSIBLE:
new route + dep, no changes to existing endpoints.

DECISION: paperOnly forms (ai-data-consent, learning-styles — storageKey null) are listed
on the cover, not dropped. Per-form read failures recorded on the cover, not thrown.
| WHY: "no silent caps" — instructor sees exactly what to add on paper.

DECISION: teacher/admin-only GET, node runtime, no-store. | WHY: expensive binary merge,
instructor-facing; mirrors existing /api/forms/download auth.

DECISION: commit as "Claude Code Agent", NOT the repo's "SPOKES Bot" identity (autopilot).
| WHY: never author work under the autopilot's identity; used `git -c` so no config change
touched main or other worktrees.

VERIFIED: unit 6/6; tsc --noEmit exit 0 (whole project); eslint clean on 3 new files;
pdf-lib merge runtime-proven (cover + copyPages + save → valid 4-page %PDF-).
NOT verified: full E2E HTTP against live storage/DB (needs app boot; low mechanical risk).
Pre-existing (untouched): TeacherOrientationWorkspace.tsx:113 react-hooks lint error on main.
