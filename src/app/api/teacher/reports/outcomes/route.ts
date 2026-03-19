import { NextResponse } from "next/server";
import { getTeacherOutcomeReport } from "@/lib/reporting";
import { withTeacherAuth } from "@/lib/api-error";

export const GET = withTeacherAuth(async () => {
  const report = await getTeacherOutcomeReport();
  return NextResponse.json(report);
});
