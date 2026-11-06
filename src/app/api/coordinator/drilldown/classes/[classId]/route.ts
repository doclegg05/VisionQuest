import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, notFound } from "@/lib/api-error";
import { recordStudentView } from "@/lib/audit";
import { withCoordinatorAuth } from "@/lib/coordinator-auth";
import { classRoster, findClassRegion } from "@/lib/coordinator/drilldown";
import { seesWholeState } from "@/lib/org-roles";
import { coordinatorHasRegion } from "@/lib/region";

interface RouteContext {
  params: Promise<{ classId: string }>;
}

const classIdSchema = z.string().cuid();

// Classroom step of the coordinator drill-down: the student roster.
export const GET = withCoordinatorAuth(
  "coordinator.student.view.region",
  async (session, _req: Request, ctx: RouteContext) => {
    const parsed = classIdSchema.safeParse((await ctx.params).classId);
    if (!parsed.success) throw badRequest("Invalid class id.");
    const classId = parsed.data;

    const { found, regionId } = await findClassRegion(classId);
    if (!found) {
      // A regional coordinator cannot tell "hidden" from "missing"; both are 403.
      if (seesWholeState(session.role)) throw notFound("Class not found.");
      throw forbidden("You are not assigned to this class's region.");
    }
    // A class with no region belongs to no regional coordinator.
    const allowed = regionId
      ? await coordinatorHasRegion(session, regionId)
      : seesWholeState(session.role);
    if (!allowed) throw forbidden("You are not assigned to this class's region.");

    const data = await classRoster(session, classId);

    // Staff reads of student data are audited (.claude/rules/security.md).
    await Promise.all(
      data.students.map((student) =>
        recordStudentView({
          actorId: session.id,
          actorRole: session.role,
          targetStudentId: student.id,
          surface: "class_roster",
        }),
      ),
    );

    return NextResponse.json({ success: true, data });
  },
);
