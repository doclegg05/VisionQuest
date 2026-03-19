import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PLATFORMS } from "@/lib/spokes/platforms";
import { matchGoalsToPlatforms } from "@/lib/spokes/goal-matcher";
import { withAuth } from "@/lib/api-error";

export const GET = withAuth(async (session) => {
  // Fetch student's active goals (BHAG + monthly) for keyword matching
  const goals = await prisma.goal.findMany({
    where: {
      studentId: session.id,
      status: "active",
      level: { in: ["bhag", "monthly"] },
    },
    select: { content: true },
  });

  const goalTexts = goals.map((g) => g.content);
  const matches = matchGoalsToPlatforms(goalTexts);

  return NextResponse.json({ platforms: PLATFORMS, goalMatches: matches.platformIds });
});
