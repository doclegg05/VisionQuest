import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { parseBody, registerTeacherSchema } from "@/lib/schemas";

function normalizeTeacherKey(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/^['"]+|['"]+$/g, "");
}

const TEACHER_KEY = normalizeTeacherKey(process.env.TEACHER_KEY || "");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`register-teacher:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, registerTeacherSchema);
  const teacherKey = normalizeTeacherKey(body.teacherKey);
  const displayName = body.displayName.trim();
  const email = normalizeEmail(body.email);
  const password = body.password.trim();

  // Validate teacher key
  if (!TEACHER_KEY) {
    return NextResponse.json({ error: "Teacher registration is not configured." }, { status: 503 });
  }
  const a = Buffer.from(teacherKey);
  const b = Buffer.from(TEACHER_KEY);
  if (!teacherKey || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    logger.warn("Invalid teacher key attempt", {
      ip,
      providedLength: teacherKey.length,
      configuredLength: TEACHER_KEY.length,
    });
    return NextResponse.json({ error: "Invalid teacher key." }, { status: 403 });
  }

  // Generate a teacher ID from email prefix
  const studentId = normalizeStudentId(email.split("@")[0] || displayName.toLowerCase().replace(/\s+/g, "."));

  const existing = await prisma.student.findFirst({
    where: {
      OR: [{ studentId }, { email }],
    },
    select: { studentId: true, email: true },
  });
  if (existing) {
    if (existing.email === email) {
      return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
    }
    return NextResponse.json({ error: "That ID is already taken. Please use a different email." }, { status: 409 });
  }

  const { hash } = hashPassword(password);
  const teacher = await prisma.student.create({
    data: {
      studentId,
      displayName,
      passwordHash: hash,
      email,
      role: "teacher",
    },
  });

  await setSessionCookie(teacher.id, teacher.role, teacher.sessionVersion);

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "auth.register_teacher",
    targetType: "student",
    targetId: teacher.id,
    summary: `New teacher registered: ${teacher.displayName} (${teacher.email}).`,
    metadata: { ip },
  });

  return NextResponse.json({
    student: {
      id: teacher.id,
      studentId: teacher.studentId,
      displayName: teacher.displayName,
      role: teacher.role,
    },
  });
});
