import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { readStudentOverview } from "@/lib/dashboard/student-dashboard";
import { requireStudent } from "@/lib/dashboard/tasks";

export const GET = withAuth(async (session) => {
  requireStudent(session);
  return NextResponse.json(await readStudentOverview(session), { headers: { "Cache-Control": "private, no-store" } });
});
