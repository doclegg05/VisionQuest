import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, normalizeStudentId, normalizeEmail, setSessionCookie } from "@/lib/auth";
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
  const login = body.studentId.trim();
  const password = body.password.trim();

  const isEmail = login.includes("@");
  const student = isEmail
    ? await prisma.student.findUnique({ where: { email: normalizeEmail(login) } })
    : await prisma.student.findUnique({ where: { studentId: normalizeStudentId(login) } });

  // Consolidate all failure cases into a single generic response to prevent account enumeration.
  // Do not distinguish between: no account found, OAuth-only account, wrong password, or inactive account.
  const isOAuthOnly = student && !student.passwordHash && student.authProvider === "google";
  const isInvalidCredentials =
    !student || !student.passwordHash || !verifyPassword(password, student.passwordHash) || !student.isActive;

  if (isOAuthOnly || isInvalidCredentials) {
    logAuditEvent({
      actorId: isOAuthOnly ? student.id : null,
      actorRole: isOAuthOnly ? student.role : null,
      action: isOAuthOnly ? "auth.login_failed_oauth" : "auth.login_failed",
      targetType: "student",
      targetId: isOAuthOnly ? student.id : undefined,
      summary: `Failed login attempt for "${login}".`,
      metadata: { ip },
    });
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
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
