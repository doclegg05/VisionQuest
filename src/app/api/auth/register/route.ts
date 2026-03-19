import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { validateSecurityQuestionAnswers } from "@/lib/security-questions";
import { hashSecurityAnswers } from "@/lib/security-question-auth";
import { parseBody, registerSchema } from "@/lib/schemas";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`register:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many registration attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, registerSchema);
  const studentId = normalizeStudentId(body.studentId);
  const displayName = body.displayName.trim();
  const password = body.password.trim();
  const email = normalizeEmail(body.email);

  // Security questions validated separately (custom logic beyond Zod)
  const securityQuestionsResult = validateSecurityQuestionAnswers(body.securityQuestions);
  if (securityQuestionsResult.error) {
    return NextResponse.json({ error: securityQuestionsResult.error }, { status: 400 });
  }

  const existing = await prisma.student.findFirst({
    where: {
      OR: [
        { studentId },
        { email },
      ],
    },
    select: {
      studentId: true,
      email: true,
    },
  });
  if (existing) {
    if (existing.studentId === studentId) {
      return NextResponse.json({ error: "That student ID is already taken." }, { status: 409 });
    }

    return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
  }

  const { hash } = hashPassword(password);
  const student = await prisma.student.create({
    data: {
      studentId,
      displayName,
      passwordHash: hash,
      email,
      role: "student",
      securityQuestionAnswers: {
        create: hashSecurityAnswers(securityQuestionsResult.answers),
      },
    },
  });

  await setSessionCookie(student.id, student.role, student.sessionVersion);

  await logAuditEvent({
    actorId: student.id,
    actorRole: student.role,
    action: "auth.register",
    targetType: "student",
    targetId: student.id,
    summary: `New student registered: ${student.studentId}.`,
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
