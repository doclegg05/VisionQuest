import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent, recordStudentView } from "@/lib/audit";
import { listManagedStudentIds } from "@/lib/classroom";
import { getWorkProfiles } from "@/lib/connect/work-profile";
import {
  AVAILABILITY_DAYS,
  AVAILABILITY_SLOTS,
  type WorkProfile,
} from "@/lib/connect/work-profile-shared";
import {
  batchFilename,
  buildWorkforceBatchCsv,
  type BatchRow,
} from "@/lib/connect/workforce-batch";
import { prisma } from "@/lib/db";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";

/**
 * "Batch to WorkForce WV" — this week's ready students as one CSV for the
 * Business Services Rep (Match & Connect Task 3.4).
 *
 * Three things this route is careful about:
 *
 *   1. SCOPE. `listManagedStudentIds` is the repo's one answer to "whose
 *      students are these"; the export never reaches beyond it.
 *   2. CONTENT. The column list lives in src/lib/connect/workforce-batch.ts
 *      and is pinned by a test against benefits, barriers and demographic
 *      field names. This file leaves the program.
 *   3. AUDIT. Exporting a roster to an outside agency is exactly the kind of
 *      staff read `recordStudentView` exists for, and the export itself gets
 *      its own audit row naming how many students it covered.
 *
 * Readiness comes from `fetchStudentReadinessData`, the single readiness
 * computation every other surface uses (2026-04-01 decision) — nothing is
 * recomputed here.
 */

/** Hard ceiling on one export, so a program-wide click cannot fan out forever. */
const MAX_STUDENTS = 200;

function countAvailableCells(profile: WorkProfile | undefined): number {
  if (!profile) return 0;
  let count = 0;
  for (const day of AVAILABILITY_DAYS) {
    for (const slot of AVAILABILITY_SLOTS) {
      if (profile.availability[day]?.[slot]) count += 1;
    }
  }
  return count;
}

export const GET = withTeacherAuth(async (session, _req: Request) => {
  const managedIds = (await listManagedStudentIds(session)).slice(0, MAX_STUDENTS);

  if (managedIds.length === 0) {
    return new Response(buildWorkforceBatchCsv([]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${batchFilename(new Date())}"`,
      },
    });
  }

  const [students, workProfiles] = await Promise.all([
    prisma.student.findMany({
      where: { id: { in: managedIds } },
      select: {
        id: true,
        displayName: true,
        certifications: {
          where: { verificationStatus: "verified" },
          select: { certType: true },
        },
        classEnrollments: {
          where: { status: "active" },
          take: 1,
          select: { class: { select: { name: true } } },
        },
      },
      orderBy: { displayName: "asc" },
    }),
    getWorkProfiles(managedIds),
  ]);

  // `fetchStudentReadinessData` is per student by construction (it is the
  // shared readiness computation, not a batch query). Running them together
  // keeps the wall time flat; the MAX_STUDENTS ceiling bounds the fan-out.
  const readiness = await Promise.all(
    students.map((student) => fetchStudentReadinessData(student.id)),
  );

  const rows: BatchRow[] = students.map((student, index) => {
    const profile = workProfiles.get(student.id);
    return {
      displayName: student.displayName,
      className: student.classEnrollments[0]?.class.name ?? "Not enrolled",
      readinessScore: readiness[index].readiness.score,
      earliestStart: profile?.earliestStart ?? null,
      availableCells: countAvailableCells(profile),
      transport: profile?.transport ?? null,
      verifiedCertifications: student.certifications.map((cert) => cert.certType),
    };
  });

  // Every student whose record fed a row: a staff read of student data, on a
  // surface of its own so the audit trail distinguishes "opened the console"
  // from "sent the roster to WorkForce WV".
  await Promise.allSettled(
    students.map((student) =>
      recordStudentView({
        actorId: session.id,
        actorRole: session.role,
        targetStudentId: student.id,
        surface: "export",
      }),
    ),
  );

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "connect.workforce_batch.exported",
    targetType: "connect_batch",
    targetId: batchFilename(new Date()),
    summary: `Exported ${rows.length} students for WorkForce WV.`,
    metadata: { studentCount: rows.length },
  });

  return new Response(buildWorkforceBatchCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${batchFilename(new Date())}"`,
    },
  });
});
