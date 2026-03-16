import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseState, createInitialState, getXpProgress, getAchievementsWithDefs } from "@/lib/progression/engine";
import { cached } from "@/lib/cache";
import { withErrorHandler, unauthorized } from "@/lib/api-error";

export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const progression = await cached(`progression:${session.id}`, 60, () =>
    prisma.progression.findUnique({ where: { studentId: session.id } }),
  );

  const state = progression ? parseState(progression.state) : createInitialState();
  const xpProgress = getXpProgress(state);
  const achievements = getAchievementsWithDefs(state);

  return NextResponse.json({
    ...state,
    xpProgress,
    achievementsWithDefs: achievements,
  });
});
