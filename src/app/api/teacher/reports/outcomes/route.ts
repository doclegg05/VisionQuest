import { NextResponse } from "next/server";
import { listManagedStudentIds } from "@/lib/classroom";
import { getTeacherOutcomeReport } from "@/lib/reporting";
import { withTeacherAuth } from "@/lib/api-error";

export const GET = withTeacherAuth(async (session) => {
  const managedStudentIds = await listManagedStudentIds(session, {
    includeInactiveAccounts: true,
  });
  const report = await getTeacherOutcomeReport(managedStudentIds);
  return NextResponse.json(report);
});
