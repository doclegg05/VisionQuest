import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";

export const GET = withTeacherAuth(
  async (session, _req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id: studentId } = await params;
    await assertStaffCanManageStudent(session, studentId);

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

    return NextResponse.json({ entries });
  }
);
