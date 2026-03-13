import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`login:${ip}`, 10, 15 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json({ error: "Too many login attempts. Please try again later." }, { status: 429 });
    }
    const body = await req.json();
    const studentId = normalizeStudentId(body.studentId || "");
    const password = (body.password || "").trim();

    if (!studentId || !password) {
      return NextResponse.json({ error: "Student ID and password are required." }, { status: 400 });
    }

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

    const token = await setSessionCookie(student.id, student.role, student.sessionVersion);

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
      token,
      student: {
        id: student.id,
        studentId: student.studentId,
        displayName: student.displayName,
        role: student.role,
      },
    });
  } catch (error) {
    logger.error("Login error", { error: String(error) });
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
