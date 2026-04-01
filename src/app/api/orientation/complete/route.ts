import { NextResponse } from "next/server";
import { recordOrientationComplete } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { withAuth, forbidden, isStaffRole, type Session } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";

async function resolveTargetStudentId(session: Session, requestedStudentId?: string | null) {
  const targetStudentId = requestedStudentId?.trim() || session.id;

  if (targetStudentId !== session.id) {
    if (!isStaffRole(session.role)) {
      throw forbidden();
    }

    await assertStaffCanManageStudent(session, targetStudentId);
  }

  return targetStudentId;
}

export const POST = withAuth(async (session, req: Request) => {
  const body = await req.json().catch(() => ({})) as { studentId?: string };
  const targetStudentId = await resolveTargetStudentId(session, body.studentId);

  await awardEvent({
    studentId: targetStudentId,
    eventType: "orientation_complete",
    sourceType: "orientation",
    sourceId: targetStudentId,
    xp: 75,
    mutate: (state) => {
      if (!state.orientationComplete) recordOrientationComplete(state);
    },
  });

  return NextResponse.json({ ok: true });
});
