import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, badRequest, notFound } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { withdrawConnectionsForConsentRevocation } from "@/lib/connect/connections";
import { generateStudentArchive } from "@/lib/student-archive";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

type RouteContext = { params: Promise<{ id: string }> };

const paramsSchema = z.object({
  id: z.string().cuid("Invalid student ID."),
});

const offboardBodySchema = z.object({
  reason: z
    .string()
    .max(500, "Reason must be 500 characters or fewer.")
    .optional(),
});

/**
 * Parse the optional JSON body. Offboarding needs no payload, so a missing
 * or empty body is treated as `{}`; a present body must pass the schema.
 */
async function parseOptionalBody(
  req: NextRequest,
): Promise<z.infer<typeof offboardBodySchema>> {
  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const result = offboardBodySchema.safeParse(raw);
  if (!result.success) {
    throw badRequest(
      result.error.issues[0]?.message || "Invalid request body.",
    );
  }
  return result.data;
}

/**
 * POST /api/admin/students/:id/offboard — admin-only manual offboarding.
 *
 * Sequence (export-before-purge; see docs/DATA_RETENTION_POLICY.md):
 *   1. Generate the full student data bundle (ZIP in Supabase Storage) via
 *      the existing archive utility. If this fails, NOTHING is changed.
 *   2. In one atomic UPDATE: isActive=false, sessionVersion+1 (forces
 *      logout everywhere), offboardedAt=now.
 *   3. Withdraw every live employer introduction, so nothing this student is
 *      no longer here to answer stays open in front of an employer.
 *   4. Audit "student.offboard".
 *
 * Idempotent: an already-offboarded student returns success with a note.
 * The original offboardedAt is preserved and no new archive is generated;
 * sessionVersion is re-bumped (harmless — just re-invalidates sessions).
 */
export const POST = withAdminAuth(
  async (session, req: NextRequest, ctx: unknown) => {
    const rawParams = await (ctx as RouteContext).params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) throw badRequest("Invalid student ID.");
    const { id: studentId } = parsedParams.data;

    const { reason } = await parseOptionalBody(req);

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, isActive: true, offboardedAt: true },
    });
    if (!student) throw notFound("Student not found.");

    if (student.offboardedAt) {
      await prisma.student.update({
        where: { id: studentId },
        data: { isActive: false, sessionVersion: { increment: 1 } },
      });

      await logAuditEvent({
        actorId: session.id,
        actorRole: session.role,
        action: "student.offboard",
        targetType: "student",
        targetId: studentId,
        summary: "Offboard repeated for already-offboarded student (no-op).",
        metadata: {
          alreadyOffboarded: true,
          sessionVersionBumped: true,
          ...(reason ? { reason } : {}),
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          alreadyOffboarded: true,
          offboardedAt: student.offboardedAt.toISOString(),
          note: "Student was already offboarded. Sessions were re-invalidated; no new archive was generated and the original offboarding timestamp was preserved.",
        },
      });
    }

    // Step 1 — export bundle FIRST. If it fails, the student stays untouched.
    let archive: { storageKey: string; fileCount: number };
    try {
      archive = await generateStudentArchive(studentId, session.id);
    } catch (error) {
      logger.error("Offboarding archive generation failed", {
        student: studentLogKey(studentId),
        error: String(error),
      });
      return NextResponse.json(
        {
          error:
            "Failed to generate the export archive. The student was not deactivated — try again.",
        },
        { status: 500 },
      );
    }

    // Step 2 — close the open employer introductions BEFORE the account goes
    // dark. An offboarded student cannot answer an employer who clicks
    // "interested" tomorrow, and their capability link would keep working
    // (it is resolved through prismaAdmin and knows nothing about isActive).
    // The same helper consent revocation uses, so the rules match: post-hire
    // rows are left alone, because offboarding does not un-get someone a job.
    //
    // Failure here does NOT abort the offboarding — a student's right to be
    // deactivated does not depend on an employer-facing side effect — but it
    // is recorded on the audit row rather than swallowed, because the
    // difference between "no live introductions" and "we could not close
    // them" is exactly what someone will need later.
    let connectionsWithdrawn: number | null = null;
    let withdrawalFailed = false;
    try {
      const result = await withdrawConnectionsForConsentRevocation(studentId, session.id);
      connectionsWithdrawn = result.withdrawn;
    } catch (error) {
      withdrawalFailed = true;
      logger.error("Offboarding could not withdraw employer introductions", {
        student: studentLogKey(studentId),
        error: String(error),
      });
    }

    // Steps 3–4 — deactivate, force logout, stamp. Single atomic UPDATE.
    const updated = await prisma.student.update({
      where: { id: studentId },
      data: {
        isActive: false,
        sessionVersion: { increment: 1 },
        offboardedAt: new Date(),
      },
      select: { isActive: true, offboardedAt: true },
    });

    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "student.offboard",
      targetType: "student",
      targetId: studentId,
      summary: "Student offboarded: exported, deactivated, sessions revoked.",
      metadata: {
        archiveStorageKey: archive.storageKey,
        archiveFileCount: archive.fileCount,
        sessionVersionBumped: true,
        connectionsWithdrawn,
        ...(withdrawalFailed ? { alert: "connection_withdrawal_failed" } : {}),
        ...(reason ? { reason } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        archive,
        connectionsWithdrawn,
        isActive: updated.isActive,
        offboardedAt: updated.offboardedAt?.toISOString() ?? null,
      },
    });
  },
);
