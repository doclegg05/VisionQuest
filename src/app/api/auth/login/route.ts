import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody, loginSchema } from "@/lib/schemas";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`login:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many login attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, loginSchema);
  const studentId = normalizeStudentId(body.studentId);
  const password = body.password.trim();

  const student = await prisma.student.findUnique({ where: { studentId } });
  if (!student || !verifyPassword(password, student.passwordHash)) {
    const resp = NextResponse.json({ error: "Invalid student ID or password." }, { status: 401 });
    logAuditEvent({
      actorId: null,
      actorRole: null,
      action: "auth.login_failed",
      targetType: "student",
      summary: `Failed login attempt for student ID "${studentId}".`,
      metadata: { ip },
    });
    return resp;
  }

  if (!student.isActive) {
    return NextResponse.json({ error: "This account has been deactivated. Please contact your instructor." }, { status: 403 });
  }

  await setSessionCookie(student.id, student.role, student.sessionVersion);

  await logAuditEvent({
    actorId: student.id,
    actorRole: student.role,
    action: "auth.login",
    targetType: "student",
    targetId: student.id,
    summary: `Login successful for ${student.studentId}.`,
    metadata: { ip },
  });

  return NextResponse.json({
    student: {
      id: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      role: student.role,
    },
  });
});
