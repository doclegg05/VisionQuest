import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";
import { resolveTargetStudentId } from "@/lib/target-student";
import { recordStudentView } from "@/lib/audit";

export const GET = withAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const targetStudentId = await resolveTargetStudentId(session, searchParams.get("studentId"));

  if (targetStudentId !== session.id) {
    // A staff read of another student's forms: write the view row.
    await recordStudentView({
      actorId: session.id,
      actorRole: session.role,
      targetStudentId,
      surface: "forms",
    });
  }

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
