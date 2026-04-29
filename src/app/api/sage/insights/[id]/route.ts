/**
 * /api/sage/insights/[id] — dismiss or (Tier B) edit a Sage insight.
 *
 * Tier A scope: dismiss only. The student can dismiss their own
 * insights; staff can dismiss any insight on a managed student.
 * Editing is deferred to Tier B once we have a richer review surface.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, badRequest, notFound, forbidden } from "@/lib/api-error";
import { isStaffRole } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { parseBody } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

const patchSchema = z.object({
  status: z.enum(["dismissed", "active"]),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const PATCH = withAuth(async (session, req: NextRequest, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);

  const existing = await prisma.sageInsight.findUnique({
    where: { id },
    select: { id: true, studentId: true, status: true },
  });
  if (!existing) throw notFound("Insight not found.");

  // Authorization: own insight, or staff with access to the student.
  if (existing.studentId !== session.id) {
    if (!isStaffRole(session.role)) {
      throw forbidden("You cannot modify this insight.");
    }
    await assertStaffCanManageStudent(session, existing.studentId);
  }

  if (body.status === existing.status) {
    // No-op — return current row without re-writing or audit-logging.
    return NextResponse.json({ ok: true, status: existing.status });
  }

  const updated = await prisma.sageInsight.update({
    where: { id },
    data: {
      status: body.status,
      ...(body.status === "dismissed"
        ? { dismissedBy: session.id, dismissedAt: new Date() }
        : { dismissedBy: null, dismissedAt: null }),
    },
    select: { id: true, status: true },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action:
      body.status === "dismissed"
        ? "sage_insight.dismiss"
        : "sage_insight.restore",
    targetType: "sage_insight",
    targetId: id,
    summary:
      body.status === "dismissed"
        ? "Dismissed a Sage insight."
        : "Restored a Sage insight.",
    metadata: { studentId: existing.studentId },
  });

  return NextResponse.json({ ok: true, status: updated.status });
});

// Documenting that DELETE is intentionally not supported in Tier A.
// To remove an insight, use PATCH with status="dismissed". Hard-delete
// is reserved for admin tooling, not exposed via this route.
export const DELETE = withAuth(async () => {
  throw badRequest(
    "Insights cannot be hard-deleted via this route. Use PATCH with status='dismissed'.",
  );
});
