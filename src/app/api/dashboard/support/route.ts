import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { readStudentSupport } from "@/lib/dashboard/student-dashboard";
import { requireStudent } from "@/lib/dashboard/tasks";

export const GET = withAuth(async (session) => {
  requireStudent(session);
  return NextResponse.json(await readStudentSupport(session), { headers: { "Cache-Control": "private, no-store" } });
});
