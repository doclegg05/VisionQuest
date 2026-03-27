import { NextRequest, NextResponse } from "next/server";
import { hashPassword, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  hasConfiguredSecurityQuestionSet,
  validateSecurityQuestionAnswers,
} from "@/lib/security-questions";
import { verifySecurityAnswer } from "@/lib/security-question-auth";
import { isValidEmail } from "@/lib/validation";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody, resetPasswordQuestionsSchema } from "@/lib/schemas";

const RESET_ERROR =
  "We could not verify those classroom recovery answers. Try again or ask your instructor for help.";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`reset-password-questions:${ip}`, 5, 60 * 60 * 1000);

  if (!rl.success) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, resetPasswordQuestionsSchema);
  const login = body.login.trim();
  const password = body.password.trim();
  const securityQuestionsResult = validateSecurityQuestionAnswers(body.securityQuestions);

  if (securityQuestionsResult.error) {
    return NextResponse.json({ error: securityQuestionsResult.error }, { status: 400 });
  }

  const email = normalizeEmail(login);
  const studentId = normalizeStudentId(login);
  const student = await prisma.student.findFirst({
    where: isValidEmail(email)
      ? {
          OR: [
            { studentId },
            { email },
          ],
        }
      : {
          studentId,
        },
    select: {
      id: true,
      role: true,
      sessionVersion: true,
      securityQuestionAnswers: {
        orderBy: { questionKey: "asc" },
        select: {
          questionKey: true,
          answerHash: true,
        },
      },
    },
  });

  if (!student || !hasConfiguredSecurityQuestionSet(student.securityQuestionAnswers.map((item) => item.questionKey))) {
    return NextResponse.json({ error: RESET_ERROR }, { status: 400 });
  }

  const storedAnswers = new Map(
    student.securityQuestionAnswers.map((item) => [item.questionKey, item.answerHash])
  );
  const answersMatch = Object.entries(securityQuestionsResult.answers).every(([questionKey, answer]) => {
    const storedHash = storedAnswers.get(questionKey);
    return storedHash ? verifySecurityAnswer(answer, storedHash) : false;
  });

  if (!answersMatch) {
    return NextResponse.json({ error: RESET_ERROR }, { status: 400 });
  }

  const { hash } = hashPassword(password);
  const result = await prisma.$transaction(async (tx) => {
    const updatedStudent = await tx.student.update({
      where: { id: student.id },
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
      where: { studentId: student.id },
    });

    return updatedStudent;
  });

  await setSessionCookie(result.id, result.role, result.sessionVersion);

  await logAuditEvent({
    actorId: result.id,
    actorRole: result.role,
    action: "auth.password.reset.security_questions",
    targetType: "student",
    targetId: result.id,
    summary: "Student reset their password with classroom recovery questions.",
    metadata: { ip },
  });

  return NextResponse.json({ ok: true });
});
