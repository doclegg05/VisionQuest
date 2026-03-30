import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTeacherAuth } from "@/lib/api-error";

export const GET = withTeacherAuth(
  async (_session, req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id: studentId } = await params;

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
