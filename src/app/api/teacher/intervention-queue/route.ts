import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { getInterventionQueue } from "@/lib/teacher/dashboard";

// ---------------------------------------------------------------------------
// GET — intervention queue sorted by urgency score (highest first)
// Optional classId query param narrows the queue to students in one class.
// ---------------------------------------------------------------------------

const classIdSchema = z
  .string()
  .regex(/^[a-z0-9]{20,32}$/i, "Invalid classId format.");

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const rawClassId = url.searchParams.get("classId")?.trim();
  let classId: string | undefined;

  if (rawClassId) {
    const parsed = classIdSchema.safeParse(rawClassId);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? "Invalid classId.");
    }
    await assertStaffCanManageClass(session, parsed.data);
    classId = parsed.data;
  }

  const data = await getInterventionQueue(session, { classId });
  return NextResponse.json(data);
});
