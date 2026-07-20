import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recordOrientationComplete } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { withAuth, forbidden, isStaffRole, type Session } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { invalidatePrefix } from "@/lib/cache";

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

/**
 * Guard (P1-1): the orientation-complete milestone (Onboarded + 75 XP) only
 * fires once every REQUIRED checklist item has a completed progress row.
 * Pending-verification claims are `completed: false`, so honor-system items
 * naturally hold completion back until an instructor confirms them.
 */
async function findIncompleteRequired(studentId: string) {
  const [requiredItems, completedRows] = await Promise.all([
    prisma.orientationItem.findMany({
      where: { required: true },
      select: { id: true },
    }),
    prisma.orientationProgress.findMany({
      where: { studentId, completed: true },
      select: { itemId: true },
    }),
  ]);
  const completedIds = new Set(completedRows.map((row) => row.itemId));
  return requiredItems.filter((item) => !completedIds.has(item.id)).map((item) => item.id);
}

export const POST = withAuth(async (session, req: Request) => {
  const body = await req.json().catch(() => ({})) as { studentId?: string };
  const targetStudentId = await resolveTargetStudentId(session, body.studentId);

  const incompleteRequiredIds = await findIncompleteRequired(targetStudentId);
  if (incompleteRequiredIds.length > 0) {
    const pendingVerification = await prisma.orientationProgress.count({
      where: {
        studentId: targetStudentId,
        itemId: { in: incompleteRequiredIds },
        verificationStatus: "pending",
      },
    });
    return NextResponse.json(
      {
        error:
          pendingVerification > 0
            ? "Orientation isn't finished yet — your instructor is still verifying some steps."
            : "Orientation isn't finished yet — required steps are still incomplete.",
        missingRequired: incompleteRequiredIds.length,
        pendingVerification,
      },
      { status: 409 },
    );
  }

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

  // Bust cached reads that depend on orientation state so the UI reflects
  // completion immediately instead of waiting out the TTL.
  invalidatePrefix(`progression:${targetStudentId}`);
  invalidatePrefix(`goals:${targetStudentId}`);

  return NextResponse.json({ ok: true });
});
