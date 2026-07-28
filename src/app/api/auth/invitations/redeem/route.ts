import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  badRequest,
  conflict,
  unauthorized,
  withErrorHandler,
} from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { getSession, setSessionCookie } from "@/lib/auth";
import {
  hashInvitationToken,
  invitationIsRedeemable,
  normalizeInvitationEmail,
} from "@/lib/classroom-invitations";
import { prismaAdmin } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { parseBody } from "@/lib/schemas";

const redeemInvitationSchema = z.object({
  token: z.string().min(32).max(256),
  email: z.email(),
  displayName: z.string().trim().min(1).max(120).optional(),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await rateLimit(`invitation-redeem:${ip}`, 8, 15 * 60 * 1000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many invitation attempts. Please try again later." },
      { status: 429 },
    );
  }

  const body = await parseBody(req, redeemInvitationSchema);
  const email = normalizeInvitationEmail(body.email);
  const tokenHash = hashInvitationToken(body.token);
  const now = new Date();
  const authenticatedSession = await getSession();

  const result = await prismaAdmin.$transaction(async (tx) => {
    const invitation = await tx.classroomInvitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        email: true,
        classId: true,
        role: true,
        expiresAt: true,
        redeemedAt: true,
        revokedAt: true,
      },
    });

    if (
      !invitation ||
      invitation.role !== "student" ||
      !invitationIsRedeemable({
        email,
        expectedEmail: invitation.email,
        expiresAt: invitation.expiresAt,
        redeemedAt: invitation.redeemedAt,
        revokedAt: invitation.revokedAt,
        now,
      })
    ) {
      throw badRequest("This invitation is invalid, expired, or already used.");
    }

    let student = await tx.student.findUnique({ where: { email } });
    if (student && (student.role !== "student" || !student.isActive)) {
      throw badRequest(
        "This invitation cannot be applied to the existing account.",
      );
    }
    const existingAccount = Boolean(student);
    if (student && authenticatedSession?.id !== student.id) {
      throw unauthorized(
        "Sign in to the existing account before accepting this invitation.",
      );
    }

    const claimed = await tx.classroomInvitation.updateMany({
      where: {
        id: invitation.id,
        redeemedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { redeemedAt: now },
    });
    if (claimed.count !== 1) {
      throw conflict("This invitation has already been used.");
    }

    if (!student) {
      const fallbackName = email.split("@")[0] || "Student";
      student = await tx.student.create({
        data: {
          studentId: `invited-${tokenHash.slice(0, 20)}`,
          displayName: body.displayName ?? fallbackName,
          email,
          emailVerified: true,
          passwordHash: null,
          authProvider: "invitation",
          role: "student",
        },
      });
    }

    await tx.studentClassEnrollment.upsert({
      where: {
        classId_studentId: {
          classId: invitation.classId,
          studentId: student.id,
        },
      },
      create: {
        classId: invitation.classId,
        studentId: student.id,
        status: "active",
      },
      update: {
        status: "active",
        archivedAt: null,
        archiveReason: null,
      },
    });

    await tx.classroomInvitation.update({
      where: { id: invitation.id },
      data: { redeemedById: student.id },
    });

    return {
      invitationId: invitation.id,
      classId: invitation.classId,
      student,
      existingAccount,
    };
  });

  if (!result.existingAccount) {
    await setSessionCookie(
      result.student.id,
      result.student.role,
      result.student.sessionVersion,
    );
  }
  await logAuditEvent({
    actorId: result.student.id,
    actorRole: result.student.role,
    action: "auth.invitation_redeemed",
    targetType: "classroom_invitation",
    targetId: result.invitationId,
    summary: `Classroom invitation redeemed by ${result.student.studentId}.`,
    metadata: { classId: result.classId },
  });

  return NextResponse.json({
    student: {
      id: result.student.id,
      studentId: result.student.studentId,
      displayName: result.student.displayName,
      role: result.student.role,
    },
    classId: result.classId,
  });
});
