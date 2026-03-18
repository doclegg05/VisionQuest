import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PLATFORMS } from "@/lib/spokes/platforms";
import { matchGoalsToPlatforms } from "@/lib/spokes/goal-matcher";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

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
}
