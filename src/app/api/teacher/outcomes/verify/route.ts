import { NextResponse } from "next/server";
import { z } from "zod";
import { syncStudentAlerts } from "@/lib/advising";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { OUTCOME_VERIFICATION } from "@/lib/outcome-verification";
import { parseBody } from "@/lib/schemas";

// P1-4 outcome verification — instructor sign-off for self-reported outcomes.
// Complements the existing requirement-level verify (PUT
// /api/teacher/certifications with { requirementId }): this endpoint stamps
// the OUTCOME row (Certification / Application) that grant reports count, so
// reports can split verified outcomes from student claims.

const verifyOutcomeSchema = z.object({
  targetType: z.enum(["certification", "application"], {
    message: "targetType must be certification or application.",
  }),
  targetId: z.string().cuid("Invalid target ID."),
  // verified=false reverts an instructor sign-off back to the self-reported
  // claim state (mirrors the requirement-level unverify).
  verified: z.boolean().optional().default(true),
});

export const POST = withTeacherAuth(async (session, req: Request) => {
  const { targetType, targetId, verified } = await parseBody(req, verifyOutcomeSchema);

  const target =
    targetType === "certification"
      ? await prisma.certification.findUnique({
          where: { id: targetId },
          select: { id: true, studentId: true, certType: true },
        })
      : await prisma.application.findUnique({
          where: { id: targetId },
          select: { id: true, studentId: true, opportunityId: true },
        });
  if (!target) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }

  await assertStaffCanManageStudent(session, target.studentId);

  // Idempotent stamp: re-verifying refreshes verifiedBy/verifiedAt; both
  // states are terminal until the student self-reports again.
  const data = verified
    ? {
        verificationStatus: OUTCOME_VERIFICATION.VERIFIED,
        verifiedBy: session.id,
        verifiedAt: new Date(),
      }
    : {
        verificationStatus: OUTCOME_VERIFICATION.SELF_REPORTED,
        verifiedBy: null,
        verifiedAt: null,
      };

  if (targetType === "certification") {
    await prisma.certification.update({ where: { id: targetId }, data });
  } else {
    await prisma.application.update({ where: { id: targetId }, data });
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: verified
      ? `teacher.${targetType}.verify`
      : `teacher.${targetType}.unverify`,
    targetType,
    targetId,
    summary: verified
      ? `Verified a self-reported ${targetType} outcome.`
      : `Reverted a ${targetType} outcome to self-reported.`,
    metadata: { studentId: target.studentId },
  });

  // The certification_unverified alert is sync-managed; re-syncing here
  // resolves it as soon as the instructor verifies.
  await syncStudentAlerts(target.studentId);

  return NextResponse.json({
    success: true,
    data: { targetType, targetId, verificationStatus: data.verificationStatus },
  });
});
