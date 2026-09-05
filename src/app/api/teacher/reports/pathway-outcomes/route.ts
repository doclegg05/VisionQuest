import { NextResponse } from "next/server";

import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { buildPathwayPlacementReport } from "@/lib/pathway-outcomes";

/**
 * GET /api/teacher/reports/pathway-outcomes — promotes
 * `scripts/pathway-outcomes-report.ts` from script-only to a report route
 * (Match & Connect Task 6.2). The script keeps working unchanged: both it
 * and this route call the same `buildPathwayPlacementReport` in
 * `src/lib/pathway-outcomes.ts`, which already carried the Prisma-free join
 * logic (extracted ahead of this plan) — this route is the promotion the
 * plan asks for, not a second implementation.
 *
 * No app-level `classId`/studentId filter here — `PathwayOutcomeReader`'s
 * query shape doesn't take one — but the scoping is not missing: `SpokesRecord`
 * RLS (`spokes_record_access`, Pattern B) already restricts a teacher session
 * to `managed_student_ids()` plus unlinked referrals, and this route runs
 * inside `withTeacherAuth`'s RLS context like every other report here, so a
 * teacher's numbers cover their own students and an admin's cover the whole
 * program. No per-student rows leave this route either way — see the
 * module's own coverage-gap caveats in its header comment before quoting
 * these numbers at anyone.
 */
export const GET = withTeacherAuth(async () => {
  const report = await buildPathwayPlacementReport(prisma);
  return NextResponse.json({ success: true, data: report });
});
