import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, conflict } from "@/lib/api-error";
import {
  assertStaffCanManageClass,
  createClassInviteToken,
  normalizeInviteInput,
} from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: classId } = await params;
  const managedClass = await assertStaffCanManageClass(session, classId);
  const body = await req.json();
  const { email, displayName, suggestedStudentId } = normalizeInviteInput({
    email: typeof body.email === "string" ? body.email : "",
    displayName: typeof body.displayName === "string" ? body.displayName : "",
    suggestedStudentId: typeof body.suggestedStudentId === "string" ? body.suggestedStudentId : "",
  });

  if (!email) {
    throw badRequest("Student email is required.");
  }

  const existingInvite = await prisma.classEnrollmentInvite.findFirst({
    where: {
      classId,
      email,
      claimedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (existingInvite) {
    throw conflict("An active invite already exists for this student email.");
  }

  const existingEnrollment = await prisma.studentClassEnrollment.findFirst({
    where: {
      classId,
      student: { email },
      status: { not: "archived" },
    },
    select: { id: true },
  });
  if (existingEnrollment) {
    throw conflict("That student is already enrolled in this class.");
  }

  const { token, tokenHash } = createClassInviteToken();
  const invite = await prisma.classEnrollmentInvite.create({
    data: {
      classId,
      email,
      displayName: displayName || null,
      suggestedStudentId: suggestedStudentId || null,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdById: session.id,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      suggestedStudentId: true,
      expiresAt: true,
    },
  });

  const inviteUrl = `${new URL(req.url).origin}/?invite=${encodeURIComponent(token)}`;

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "class.invite.create",
    targetType: "class",
    targetId: classId,
    summary: `Created a student invite for ${managedClass.name}.`,
    metadata: {
      inviteId: invite.id,
      email: invite.email,
    },
  });

  return NextResponse.json({
    invite: {
      ...invite,
      className: managedClass.name,
      inviteUrl,
      token,
    },
  });
});
