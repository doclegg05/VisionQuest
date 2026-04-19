import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, notFound } from "@/lib/api-error";
import { withCoordinatorAuth } from "@/lib/coordinator-auth";
import { prisma } from "@/lib/db";
import { coordinatorHasRegion } from "@/lib/region";
import { GRANT_METRICS } from "@/lib/grant-metrics";

const PROGRAM_TYPES = ["spokes", "adult_ed", "ietp", "all"] as const;

const updateSchema = z
  .object({
    programType: z.enum(PROGRAM_TYPES).optional(),
    metric: z.enum(GRANT_METRICS).optional(),
    targetValue: z.number().nonnegative().finite().optional(),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.periodStart && value.periodEnd) {
      if (new Date(value.periodEnd) <= new Date(value.periodStart)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "periodEnd must be after periodStart.",
          path: ["periodEnd"],
        });
      }
    }
  });

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function loadAndAuthorize(session: Parameters<typeof withCoordinatorAuth>[1] extends (session: infer S, ...rest: unknown[]) => unknown ? S : never, id: string) {
  const existing = await prisma.grantGoal.findUnique({
    where: { id },
    select: { id: true, regionId: true },
  });
  if (!existing) throw notFound("Grant goal not found.");
  const authorized = await coordinatorHasRegion(session, existing.regionId);
  if (!authorized) throw forbidden("You are not assigned to this region.");
  return existing;
}

export const PATCH = withCoordinatorAuth(
  "coordinator.grant.edit",
  async (session, req: Request, ctx: RouteContext) => {
    const { id } = await ctx.params;
    await loadAndAuthorize(session, id);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw badRequest("Body must be a JSON object.");
    }

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? "Invalid grant goal payload.");
    }

    const updated = await prisma.grantGoal.update({
      where: { id },
      data: {
        ...(parsed.data.programType !== undefined ? { programType: parsed.data.programType } : {}),
        ...(parsed.data.metric !== undefined ? { metric: parsed.data.metric } : {}),
        ...(parsed.data.targetValue !== undefined ? { targetValue: parsed.data.targetValue } : {}),
        ...(parsed.data.periodStart !== undefined ? { periodStart: new Date(parsed.data.periodStart) } : {}),
        ...(parsed.data.periodEnd !== undefined ? { periodEnd: new Date(parsed.data.periodEnd) } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      },
    });

    return NextResponse.json({
      goal: {
        ...updated,
        periodStart: updated.periodStart.toISOString(),
        periodEnd: updated.periodEnd.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  },
);

export const DELETE = withCoordinatorAuth(
  "coordinator.grant.edit",
  async (session, _req: Request, ctx: RouteContext) => {
    const { id } = await ctx.params;
    await loadAndAuthorize(session, id);
    await prisma.grantGoal.delete({ where: { id } });
    return NextResponse.json({ success: true });
  },
);
