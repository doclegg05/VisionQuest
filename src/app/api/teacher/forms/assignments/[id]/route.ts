import { NextResponse } from "next/server";

import { notFound, withTeacherAuth } from "@/lib/api-error";
import {
  assertStaffCanManageClass,
  assertStaffCanManageStudent,
} from "@/lib/classroom";
import { prisma } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const DELETE = withTeacherAuth(async (session, _req: Request, ctx: RouteContext) => {
  const { id } = await ctx.params;

  const assignment = await prisma.formAssignment.findUnique({
    where: { id },
    select: { id: true, scope: true, targetId: true },
  });
  if (!assignment) throw notFound("Assignment not found.");

  // Authorization: teacher must manage the class/student the assignment targets.
  if (assignment.scope === "class") {
    await assertStaffCanManageClass(session, assignment.targetId);
  } else {
    await assertStaffCanManageStudent(session, assignment.targetId);
  }

  await prisma.formAssignment.delete({ where: { id } });

  return NextResponse.json({ success: true });
});
