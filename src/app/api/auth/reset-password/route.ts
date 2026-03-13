import { NextRequest, NextResponse } from "next/server";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPasswordResetToken } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`reset-password:${ip}`, 10, 60 * 60 * 1000);

  if (!rl.success) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again later." }, { status: 429 });
  }

  const body = await req.json();
  const token = String(body.token || "").trim();
  const password = String(body.password || "").trim();

  if (!token) {
    return NextResponse.json({ error: "This reset link is invalid." }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  const tokenHash = hashPasswordResetToken(token);
  const now = new Date();
  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      student: {
        select: {
          id: true,
          role: true,
          sessionVersion: true,
        },
      },
    },
  });

  if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt <= now) {
    return NextResponse.json({ error: "This reset link has expired or has already been used." }, { status: 400 });
  }

  const { hash } = hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const markedUsed = await tx.passwordResetToken.updateMany({
      where: {
        id: resetRecord.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (markedUsed.count !== 1) {
      throw new Error("Reset token is no longer valid.");
    }

    const student = await tx.student.update({
      where: { id: resetRecord.student.id },
      data: {
        passwordHash: hash,
        sessionVersion: { increment: 1 },
      },
      select: {
        id: true,
        role: true,
        sessionVersion: true,
      },
    });

    await tx.passwordResetToken.deleteMany({
      where: { studentId: resetRecord.student.id },
    });

    return {
      studentId: student.id,
      role: student.role,
      sessionVersion: student.sessionVersion,
    };
  });

  await setSessionCookie(result.studentId, result.role, result.sessionVersion);

  await logAuditEvent({
    actorId: result.studentId,
    actorRole: result.role,
    action: "auth.password.reset",
    targetType: "student",
    targetId: result.studentId,
    summary: "Student reset their password with an emailed recovery link.",
  });

  return NextResponse.json({ ok: true });
}
