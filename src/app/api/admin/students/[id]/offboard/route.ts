import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, badRequest, notFound } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { generateStudentArchive } from "@/lib/student-archive";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";

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
 *   3. Audit "student.offboard".
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
        studentId,
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

    // Steps 2–4 — deactivate, force logout, stamp. Single atomic UPDATE.
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
        ...(reason ? { reason } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        archive,
        isActive: updated.isActive,
        offboardedAt: updated.offboardedAt?.toISOString() ?? null,
      },
    });
  },
);
