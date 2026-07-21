import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

const discoveryOverrideSchema = z.object({
  status: z.literal("complete"),
});

/**
 * PATCH — manually mark a student's career discovery complete.
 *
 * Normally CareerDiscovery.status flips to "complete" only when the Sage
 * discovery extractor reports stage_complete. If the extractor never fires,
 * the student is pinned at the Discover step forever. This override lets
 * staff unblock them; the manual source is recorded in the audit log
 * (CareerDiscovery has no completedBy/source column by design).
 *
 * Idempotent: calling it for an already-complete discovery changes nothing
 * and writes no additional audit row.
 */
export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  const body: unknown = await req.json().catch(() => null);
  const parsed = discoveryOverrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'status must be "complete"' }, { status: 400 });
  }

  // Throws 403 when this staff member does not manage the student.
  const student = await assertStaffCanManageStudent(session, id);

  const existing = await prisma.careerDiscovery.findUnique({
    where: { studentId: student.id },
    select: { status: true, completedAt: true },
  });

  if (existing?.status === "complete") {
    return NextResponse.json({ ok: true, status: "complete", alreadyComplete: true });
  }

  const now = new Date();
  await prisma.careerDiscovery.upsert({
    where: { studentId: student.id },
    update: {
      status: "complete",
      completedAt: existing?.completedAt ?? now,
    },
    create: {
      studentId: student.id,
      status: "complete",
      completedAt: now,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.student.discovery_override",
    targetType: "student",
    targetId: student.id,
    summary: `Manually marked career discovery complete for student ${student.studentId}.`,
    metadata: {
      studentId: student.id,
      source: "manual_override",
      previousStatus: existing?.status ?? null,
    },
  });

  return NextResponse.json({ ok: true, status: "complete", alreadyComplete: false });
});
