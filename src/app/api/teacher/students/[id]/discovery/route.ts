import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";

const CLUSTER_IDS = new Set(CAREER_CLUSTERS.map((cluster) => cluster.id));

const discoveryOverrideSchema = z.object({
  status: z.literal("complete"),
  // Optional: lets a teacher pick the SPOKES career cluster directly when
  // the Sage extractor marked discovery complete but never recorded one
  // (see the PATCH doc comment below). Omitting it keeps the original,
  // cluster-blind override behavior fully backward compatible.
  clusterId: z
    .string()
    .refine((id) => CLUSTER_IDS.has(id), {
      message: "clusterId must be a known SPOKES career cluster id",
    })
    .optional(),
});

/**
 * PATCH — manually mark a student's career discovery complete, optionally
 * picking their top SPOKES career cluster.
 *
 * Normally CareerDiscovery.status flips to "complete" only when the Sage
 * discovery extractor reports stage_complete AND records topClusters. If the
 * extractor fires with status but no clusters, or never fires at all, the
 * student is pinned at the Discover step forever — the learning pathway has
 * nothing to build from. This override lets staff unblock them; the manual
 * source is recorded in the audit log (CareerDiscovery has no
 * completedBy/source column by design).
 *
 * Idempotent: calling it again with nothing new to change (status already
 * "complete" and, when a clusterId is given, it already matches the stored
 * top cluster) changes nothing and writes no additional audit row. Critically,
 * an already-"complete" discovery does NOT short-circuit when a clusterId is
 * supplied — that was the exact dead end this route used to leave staff in:
 * status flips to "complete" with an empty topClusters, and there was no way
 * to ever write a cluster in afterward.
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'status must be "complete"' },
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

  const statusAlreadyComplete = existing?.status === "complete";
  const clusterAlreadySet = clusterId ? existing?.topClusters?.[0] === clusterId : true;

  if (statusAlreadyComplete && clusterAlreadySet) {
    return NextResponse.json({ ok: true, status: "complete", alreadyComplete: true });
  }

  const now = new Date();
  await prisma.careerDiscovery.upsert({
    where: { studentId: student.id },
    update: {
      status: "complete",
      completedAt: existing?.completedAt ?? now,
      ...(clusterId ? { topClusters: [clusterId] } : {}),
    },
    create: {
      studentId: student.id,
      status: "complete",
      completedAt: now,
      ...(clusterId ? { topClusters: [clusterId] } : {}),
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.student.discovery_override",
    targetType: "student",
    targetId: student.id,
    summary: clusterId
      ? `Manually marked career discovery complete for student ${student.studentId} and set the ${clusterId} career cluster.`
      : `Manually marked career discovery complete for student ${student.studentId}.`,
    metadata: {
      studentId: student.id,
      source: "manual_override",
      previousStatus: existing?.status ?? null,
      ...(clusterId ? { clusterId } : {}),
    },
  });

  return NextResponse.json({ ok: true, status: "complete", alreadyComplete: false });
});
