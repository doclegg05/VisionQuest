import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseState, createInitialState, getXpProgress, getAchievementsWithDefs } from "@/lib/progression/engine";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const progression = await prisma.progression.findUnique({
    where: { studentId: session.id },
  });

  const state = progression ? parseState(progression.state) : createInitialState();
  const xpProgress = getXpProgress(state);
  const achievements = getAchievementsWithDefs(state);

  return NextResponse.json({
    ...state,
    xpProgress,
    achievementsWithDefs: achievements,
  });
}
