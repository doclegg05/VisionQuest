import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { recordStudentView } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";

export const GET = withTeacherAuth(
  async (session, _req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id: identifier } = await params;
    const { id: studentId } = await assertStaffCanManageStudent(session, identifier);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const entries = await prisma.moodEntry.findMany({
      where: {
        studentId,
        extractedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { extractedAt: "asc" },
      select: {
        id: true,
        score: true,
        context: true,
        source: true,
        conversationId: true,
        extractedAt: true,
      },
    });

    await recordStudentView({
      actorId: session.id,
      actorRole: session.role,
      targetStudentId: studentId,
      surface: "mood",
    });

    return NextResponse.json({ entries });
  }
);
