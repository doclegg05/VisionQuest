import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { getClusterById } from "@/lib/spokes/career-clusters";

const discoveryOverrideSchema = z.object({
  status: z.literal("complete"),
  clusterId: z
    .string()
    .refine((id) => getClusterById(id) !== undefined, {
      message: "clusterId must be a SPOKES career cluster",
    })
    .optional(),
});

/**
 * PATCH — manually mark a student's career discovery complete, optionally
 * recording a SPOKES career cluster in topClusters.
 *
 * Normally CareerDiscovery.status flips to "complete" only when the Sage
 * discovery extractor reports stage_complete. If the extractor never fires,
 * the student is pinned at the Discover step forever. This override lets
 * staff unblock them; the manual source is recorded in the audit log
 * (CareerDiscovery has no completedBy/source column by design).
 *
 * A provided clusterId is prepended to topClusters (the teacher's explicit
 * pick leads) without duplicating an entry already there. Crucially, the
 * cluster write also applies to an already-complete discovery: a discovery
 * completed with no topClusters used to be a dead end, because the
 * idempotency short-circuit returned before the upsert.
 *
 * Idempotent: a call that would change neither status nor topClusters
 * changes nothing and writes no additional audit row.
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
    const clusterIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "clusterId",
    );
    return NextResponse.json(
      {
        error: clusterIssue
          ? "clusterId must be a SPOKES career cluster"
          : 'status must be "complete"',
      },
      { status: 400 },
    );
  }
  const { clusterId } = parsed.data;

  // Throws 403 when this staff member does not manage the student.
  const student = await assertStaffCanManageStudent(session, id);

  const existing = await prisma.careerDiscovery.findUnique({
    where: { studentId: student.id },
    select: { status: true, completedAt: true, topClusters: true },
  });

  const alreadyComplete = existing?.status === "complete";
  const existingClusters = existing?.topClusters ?? [];
  const nextTopClusters =
    clusterId !== undefined && !existingClusters.includes(clusterId)
      ? [clusterId, ...existingClusters]
      : undefined;

  if (alreadyComplete && nextTopClusters === undefined) {
    return NextResponse.json({ ok: true, status: "complete", alreadyComplete: true });
  }

  const now = new Date();
  await prisma.careerDiscovery.upsert({
    where: { studentId: student.id },
    update: {
      status: "complete",
      completedAt: existing?.completedAt ?? now,
      ...(nextTopClusters !== undefined ? { topClusters: nextTopClusters } : {}),
    },
    create: {
      studentId: student.id,
      status: "complete",
      completedAt: now,
      ...(clusterId !== undefined ? { topClusters: [clusterId] } : {}),
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.student.discovery_override",
    targetType: "student",
    targetId: student.id,
    summary: alreadyComplete
      ? `Recorded career cluster ${clusterId} on the completed discovery for student ${student.studentId}.`
      : clusterId !== undefined
        ? `Manually marked career discovery complete for student ${student.studentId} (cluster: ${clusterId}).`
        : `Manually marked career discovery complete for student ${student.studentId}.`,
    metadata: {
      studentId: student.id,
      source: "manual_override",
      previousStatus: existing?.status ?? null,
      ...(clusterId !== undefined ? { clusterId } : {}),
    },
  });

  return NextResponse.json({ ok: true, status: "complete", alreadyComplete });
});
