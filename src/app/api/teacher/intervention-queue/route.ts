import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { getInterventionQueue } from "@/lib/teacher/dashboard";

// ---------------------------------------------------------------------------
// GET — intervention queue sorted by urgency score (highest first)
// ---------------------------------------------------------------------------

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId")?.trim() || undefined;
  const data = await getInterventionQueue(session, { classId });
  return NextResponse.json(data);
});
