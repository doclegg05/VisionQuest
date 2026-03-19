import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { isValidEmail, MAX_LENGTHS } from "@/lib/validation";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { logger } from "@/lib/logger";

const TEACHER_KEY = process.env.TEACHER_KEY || "";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`register-teacher:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await req.json();
  const teacherKey = (body.teacherKey || "").trim();
  const displayName = (body.displayName || "").trim();
  const email = normalizeEmail(body.email || "");
  const password = (body.password || "").trim();

  // Validate teacher key first
  if (!TEACHER_KEY) {
    return NextResponse.json({ error: "Teacher registration is not configured." }, { status: 503 });
  }
  if (!teacherKey || teacherKey !== TEACHER_KEY) {
    logger.warn("Invalid teacher key attempt", { ip });
    return NextResponse.json({ error: "Invalid teacher key." }, { status: 403 });
  }

  if (!displayName) {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 });
  }
  if (displayName.length > MAX_LENGTHS.displayName) {
    return NextResponse.json({ error: `Display name must be ${MAX_LENGTHS.displayName} characters or fewer.` }, { status: 400 });
  }
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (password.length > MAX_LENGTHS.password) {
    return NextResponse.json({ error: `Password must be ${MAX_LENGTHS.password} characters or fewer.` }, { status: 400 });
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
