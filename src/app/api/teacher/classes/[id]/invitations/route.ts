import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth, badRequest } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { assertStaffCanManageClass } from "@/lib/classroom";
import {
  createInvitationToken,
  DEFAULT_INVITATION_TTL_HOURS,
  hashInvitationToken,
  normalizeInvitationEmail,
} from "@/lib/classroom-invitations";
import { prismaAdmin } from "@/lib/db";
import { parseBody } from "@/lib/schemas";

const createInvitationSchema = z.object({
  email: z.email(),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(168)
    .default(DEFAULT_INVITATION_TTL_HOURS),
});

export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: classId } = await params;
  const body = await parseBody(req, createInvitationSchema);
  const managedClass = await assertStaffCanManageClass(session, classId);
  if (managedClass.status === "archived") {
    throw badRequest("Invitations cannot be created for an archived class.");
  }

  const email = normalizeInvitationEmail(body.email);
  const token = createInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(
    Date.now() + body.expiresInHours * 60 * 60 * 1000,
  );

  const invitation = await prismaAdmin.$transaction(async (tx) => {
    await tx.classroomInvitation.updateMany({
      where: {
        classId,
        email,
        redeemedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    return tx.classroomInvitation.create({
      data: {
        tokenHash,
        email,
        classId,
        expiresAt,
        createdById: session.id,
      },
      select: {
        id: true,
        email: true,
        classId: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "auth.invitation_created",
    targetType: "classroom_invitation",
    targetId: invitation.id,
    summary: `Created a classroom invitation for ${managedClass.name}.`,
    metadata: { classId, expiresAt: expiresAt.toISOString() },
  });

  const redemptionUrl = new URL("/invite", req.url);
  redemptionUrl.searchParams.set("token", token);
  redemptionUrl.searchParams.set("email", email);

  return NextResponse.json(
    {
      invitation,
      // The bearer token is returned once so staff can deliver it through
      // the approved channel. Only its SHA-256 digest is stored.
      token,
      redemptionUrl: redemptionUrl.toString(),
    },
    { status: 201 },
  );
});
