import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden } from "@/lib/api-error";
import { withCoordinatorAuth } from "@/lib/coordinator-auth";
import { regionOverview } from "@/lib/coordinator/drilldown";
import { coordinatorHasRegion } from "@/lib/region";

interface RouteContext {
  params: Promise<{ regionId: string }>;
}

const regionIdSchema = z.string().cuid();

// Region step of the coordinator drill-down: instructors and their classes.
export const GET = withCoordinatorAuth(
  "coordinator.student.view.region",
  async (session, _req: Request, ctx: RouteContext) => {
    const parsed = regionIdSchema.safeParse((await ctx.params).regionId);
    if (!parsed.success) throw badRequest("Invalid region id.");

    if (!(await coordinatorHasRegion(session, parsed.data))) {
      throw forbidden("You are not assigned to this region.");
    }

    const data = await regionOverview(session, parsed.data);
    return NextResponse.json({ success: true, data });
  },
);
