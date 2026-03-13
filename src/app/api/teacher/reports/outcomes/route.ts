import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTeacherOutcomeReport } from "@/lib/reporting";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const report = await getTeacherOutcomeReport();
  return NextResponse.json(report);
}
