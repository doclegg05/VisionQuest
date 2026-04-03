import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { getTeacherDashboardPage } from "@/lib/teacher/dashboard";

// GET — class overview: all students with cross-module progress
export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const showInactive = url.searchParams.get("showInactive") === "true";
  const classId = url.searchParams.get("classId")?.trim() || undefined;

  const data = await getTeacherDashboardPage(session, {
    page,
    limit,
    showInactive,
    classId,
  });

  return NextResponse.json(data);
});
