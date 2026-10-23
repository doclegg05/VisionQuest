import { NextRequest, NextResponse } from "next/server";
import { hashPassword, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { prismaAdmin as prisma } from "@/lib/db";
import { clientIpBucket } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import {
  hasConfiguredSecurityQuestionSet,
  validateSecurityQuestionAnswers,
  type SecurityQuestionAnswers,
} from "@/lib/security-questions";
import { verifySecurityAnswer } from "@/lib/security-question-auth";
import { isValidEmail } from "@/lib/validation";
import { logAuditEvent } from "@/lib/audit";
import { isStaffRole, withErrorHandler } from "@/lib/api-error";
import { parseBody, resetPasswordQuestionsSchema } from "@/lib/schemas";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

const RESET_ERROR =
  "We could not verify those classroom recovery answers. Try again or ask your instructor for help.";

/**
 * Per-account bounds: the same five attempts as the per-IP limit below, but
 * counted against the target account so guesses from many addresses share
 * one budget. Three short answers set a password and issue a session here,
 * which is why the window is the route's full hour rather than login's
 * fifteen minutes.
 */
const ACCOUNT_LIMIT_ATTEMPTS = 5;
const ACCOUNT_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Stands in for an account whose answers must not be checked: unknown,
 * locked, staff, or without a full question set. Every lookup misses, so each
 * answer runs against auth's dummy hash instead.
 */
const NO_STORED_ANSWERS: ReadonlyMap<string, string> = new Map();

/**
 * Runs one KDF per answer on every request and only then combines the
 * results. Stopping at the first wrong answer, or skipping the KDF for an
 * account that cannot recover, lets response time show which answers were
 * right and whether the login exists.
 */
function verifyEveryAnswer(
  answers: SecurityQuestionAnswers,
  storedAnswers: ReadonlyMap<string, string>,
): boolean {
  const results = Object.entries(answers).map(([questionKey, answer]) =>
    verifySecurityAnswer(answer, storedAnswers.get(questionKey)),
  );
  return results.every(Boolean);
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = clientIpBucket(req);
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

  // Per-account limit, keyed on the target account. The login is not a
  // secret, so answers get guessed from anywhere; counting here, before the
  // answers are checked, means every guess spends the budget.
  if (student) {
    const accountRl = await rateLimit(
      `reset-password-questions:user:${student.id}`,
      ACCOUNT_LIMIT_ATTEMPTS,
      ACCOUNT_LIMIT_WINDOW_MS,
    );
    // A locked account answers exactly like an unknown one or a wrong answer.
    // This route is reachable without a session, so a distinct 429 would
    // confirm the account exists (audit S1 on PR #196). The attempt is still
    // counted, the lockout is recorded once per window below, and the running
    // total stays visible in the rate-limit table.
    if (!accountRl.success) {
      // Same KDF work as every other refusal, so a locked account is not
      // answered faster than an unknown one.
      verifyEveryAnswer(securityQuestionsResult.answers, NO_STORED_ANSWERS);
      return NextResponse.json({ error: RESET_ERROR }, { status: 400 });
    }

    // Recorded once, when the last admitted attempt lands: every later
    // request is refused above and writes nothing (audit S2). A degraded
    // limiter reports remaining 0 too, and its store is the one that just
    // failed, so it records nothing.
    if (accountRl.remaining === 0 && !accountRl.degraded) {
      logger.warn("Security-question reset attempts exhausted for the window", {
        student: studentLogKey(student.id),
      });
      await logAuditEvent({
        actorId: null,
        actorRole: null,
        action: "auth.password.reset.security_questions_locked_out",
        targetType: "student",
        targetId: student.id,
        summary:
          "Classroom recovery used its last answer attempt for this window; further attempts are refused until the window resets.",
        metadata: { ip, resetAt: new Date(accountRl.resetTime).toISOString() },
      });
    }
  }

  // Unknown, unconfigured, and staff accounts are refused only after the same
  // three KDF runs a real attempt costs, and with the same response as a
  // wrong answer: a fast reply or a distinct status would confirm the login.
  const canRecover =
    student !== null &&
    hasConfiguredSecurityQuestionSet(student.securityQuestionAnswers.map((item) => item.questionKey)) &&
    !isStaffRole(student.role);
  const storedAnswers = canRecover
    ? new Map(student.securityQuestionAnswers.map((item) => [item.questionKey, item.answerHash]))
    : NO_STORED_ANSWERS;
  const answersMatch = verifyEveryAnswer(securityQuestionsResult.answers, storedAnswers);

  if (!student || !canRecover || !answersMatch) {
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
