import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
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

export const GET = withAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const targetStudentId = await resolveTargetStudentId(session, searchParams.get("studentId"));

  const submissions = await prisma.formSubmission.findMany({
    where: { studentId: targetStudentId },
    select: {
      id: true,
      formId: true,
      fileId: true,
      status: true,
      reviewedAt: true,
      notes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ submissions });
});
