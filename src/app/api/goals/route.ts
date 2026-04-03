import { NextResponse } from "next/server";
import { badRequest } from "@/lib/api-error";
import { withRegistry } from "@/lib/registry/middleware";
import { cached, invalidatePrefix } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { ensureGoalLevelProgression } from "@/lib/goal-progression";
import { goalCountsTowardPlan, isGoalLevel, isGoalStatus, type GoalStatus } from "@/lib/goals";

function parseGoalStatusFilters(url: URL): GoalStatus[] | null {
  const rawStatuses = url.searchParams.getAll("status")
    .map((status) => status.trim())
    .filter(Boolean);

  if (rawStatuses.length === 0) return null;

  const invalid = rawStatuses.find((status) => !isGoalStatus(status));
  if (invalid) {
    throw badRequest(`Invalid goal status: ${invalid}`);
  }

  return [...new Set(rawStatuses)] as GoalStatus[];
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("invalid");
    }
    return body as Record<string, unknown>;
  } catch {
    throw badRequest("Invalid JSON body.");
  }
}

export const GET = withRegistry("goals.list", async (session, req, ctx, tool) => {
  const statusFilters = parseGoalStatusFilters(new URL(req.url));
  const allGoals = await cached(`goals:${session.id}`, 30, () =>
    prisma.goal.findMany({
      where: { studentId: session.id },
      orderBy: { createdAt: "asc" },
    }),
  );

  const goals = statusFilters
    ? allGoals.filter((goal) => statusFilters.includes(goal.status as GoalStatus))
    : allGoals;

  return NextResponse.json({ goals });
});

export const POST = withRegistry("goals.create", async (session, req, ctx, tool) => {
  const body = await readJsonBody(req);
  const rawLevel = typeof body.level === "string" ? body.level.trim().toLowerCase() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const rawStatus = typeof body.status === "string" ? body.status.trim().toLowerCase() : "active";
  const parentId = typeof body.parentId === "string" && body.parentId.trim() ? body.parentId.trim() : null;

  if (!isGoalLevel(rawLevel)) {
    throw badRequest("Goal level is required.");
  }

  if (!content) {
    throw badRequest("Goal content is required.");
  }

  if (content.length > 500) {
    throw badRequest("Goal content must be 500 characters or fewer.");
  }

  if (!isGoalStatus(rawStatus)) {
    throw badRequest("Goal status is invalid.");
  }

  if (parentId) {
    const parentGoal = await prisma.goal.findFirst({
      where: { id: parentId, studentId: session.id },
      select: { id: true },
    });
    if (!parentGoal) {
      throw badRequest("Parent goal not found.");
    }
  }

  const goal = await prisma.goal.create({
    data: {
      studentId: session.id,
      level: rawLevel,
      content,
      status: rawStatus,
      parentId,
    },
  });

  invalidatePrefix(`goals:${session.id}`);

  if (goalCountsTowardPlan(goal.status)) {
    await ensureGoalLevelProgression(session.id, [rawLevel]);
  }

  return NextResponse.json({ goal }, { status: 201 });
});
