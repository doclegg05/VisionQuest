import { NextResponse } from "next/server";
import { listManagedStudentIds } from "@/lib/classroom";
import { emptyTeacherOutcomeReport, getTeacherOutcomeReport } from "@/lib/reporting";
import { withTeacherAuth } from "@/lib/api-error";

export const GET = withTeacherAuth(async (session) => {
  const managedStudentIds = await listManagedStudentIds(session, {
    includeInactiveAccounts: true,
  });
  // An instructor with no students gets an empty report. The report helper
  // refuses an empty list rather than widening it to every student.
  const report =
    managedStudentIds.length === 0
      ? emptyTeacherOutcomeReport()
      : await getTeacherOutcomeReport(managedStudentIds);
  return NextResponse.json(report);
});
