import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withRegistry } from "@/lib/registry/middleware";

export const GET = withRegistry("learning.mood", async (session, _req, _ctx, _tool) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const entries = await prisma.moodEntry.findMany({
    where: {
      studentId: session.id,
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
});
