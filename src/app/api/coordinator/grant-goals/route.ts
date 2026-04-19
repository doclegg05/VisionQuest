import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden } from "@/lib/api-error";
import { withCoordinatorAuth } from "@/lib/coordinator-auth";
import { prisma } from "@/lib/db";
import { coordinatorHasRegion } from "@/lib/region";
import { GRANT_METRICS } from "@/lib/grant-metrics";

const PROGRAM_TYPES = ["spokes", "adult_ed", "ietp", "all"] as const;

const createSchema = z.object({
  regionId: z.string().min(1),
  programType: z.enum(PROGRAM_TYPES),
  metric: z.enum(GRANT_METRICS),
  targetValue: z.number().nonnegative().finite(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (new Date(value.periodEnd) <= new Date(value.periodStart)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "periodEnd must be after periodStart.",
      path: ["periodEnd"],
    });
  }
});

export const GET = withCoordinatorAuth(
  "coordinator.grant.view",
  async (session, req: Request) => {
    const url = new URL(req.url);
    const regionId = url.searchParams.get("regionId")?.trim();
    if (!regionId) throw badRequest("regionId query param is required.");

    const authorized = await coordinatorHasRegion(session, regionId);
    if (!authorized) throw forbidden("You are not assigned to this region.");

    const goals = await prisma.grantGoal.findMany({
      where: { regionId },
      orderBy: [{ periodStart: "desc" }, { metric: "asc" }],
    });

    return NextResponse.json({
      goals: goals.map((goal) => ({
        ...goal,
        periodStart: goal.periodStart.toISOString(),
        periodEnd: goal.periodEnd.toISOString(),
        createdAt: goal.createdAt.toISOString(),
        updatedAt: goal.updatedAt.toISOString(),
      })),
    });
  },
);

export const POST = withCoordinatorAuth(
  "coordinator.grant.edit",
  async (session, req: Request) => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw badRequest("Body must be a JSON object.");
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? "Invalid grant goal payload.");
    }

    const authorized = await coordinatorHasRegion(session, parsed.data.regionId);
    if (!authorized) throw forbidden("You are not assigned to this region.");

    const created = await prisma.grantGoal.create({
      data: {
        regionId: parsed.data.regionId,
        programType: parsed.data.programType,
        metric: parsed.data.metric,
        targetValue: parsed.data.targetValue,
        periodStart: new Date(parsed.data.periodStart),
        periodEnd: new Date(parsed.data.periodEnd),
        notes: parsed.data.notes ?? null,
      },
    });

    return NextResponse.json(
      {
        goal: {
          ...created,
          periodStart: created.periodStart.toISOString(),
          periodEnd: created.periodEnd.toISOString(),
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      },
      { status: 201 },
    );
  },
);
