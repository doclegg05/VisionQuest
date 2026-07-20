import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { withRegistry } from "@/lib/registry/middleware";

export const GET = withRegistry("learning.mood", async (session, _req, _ctx, _tool) => {
  const rl = await rateLimit(`mood:${session.id}`, 30, 60 * 60 * 1000);
  if (!rl.success) {
    throw rateLimited("Too many mood requests this hour. Please wait before trying again.");
  }

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
