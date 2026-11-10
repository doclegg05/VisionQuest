import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hashPassword, invalidateSessionCache, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { prismaAdmin as prisma } from "@/lib/db";
import { clientIpBucket } from "@/lib/client-ip";
import { rateLimit, refundRateLimit } from "@/lib/rate-limit";
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
import { getJwtSecret } from "@/lib/session-token";

const RESET_ERROR =
  "We could not verify those classroom recovery answers. Try again or ask your instructor for help.";

/** What every login reads while the per-account limiter cannot count: it says nothing about the account or the answers. */
const RECOVERY_UNAVAILABLE_ERROR =
  "We cannot reset passwords this way right now. Try again in a few minutes, or ask your instructor for help.";

/**
 * FAILED attempts one network address may make per hour. 20 is room for a
 * classroom's mistyped answers and no more: a recovery that worked gives its
 * unit back, and this route sets a password from three short answers. This
 * bucket slows one address guessing across many accounts. It is a courtesy
 * limit: the address comes from `X-Forwarded-For`, which a caller can set
 * (src/lib/client-ip.ts). The per-account limit below is the real control.
 * An attempt holds its unit until it is answered, so failed attempts plus
 * attempts in flight can never pass 20.
 */
const NETWORK_FAILED_ATTEMPT_LIMIT = 20;
const NETWORK_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Per-account bounds: five attempts, counted against the target account so
 * guesses from many addresses share one budget, and never given back. Three
 * short answers set a password and issue a session here, which is why the
 * window is the route's full hour rather than login's fifteen minutes.
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

/** Built fresh per request so no caller can change the shared answer. */
function resetRefused(): NextResponse {
  return NextResponse.json({ error: RESET_ERROR }, { status: 400 });
}

/** A typed login in the forms the account lookup uses. `email` is null unless the login is email-shaped. */
interface RecoveryLogin {
  studentId: string;
  email: string | null;
}

function normalizeRecoveryLogin(login: string): RecoveryLogin {
  const email = normalizeEmail(login);
  return { studentId: normalizeStudentId(login), email: isValidEmail(email) ? email : null };
}

/**
 * Per-login limiter key for a login that names no account. An HMAC of the
 * normalized login under the server's JWT secret, as sign-in does
 * (login/route.ts) but under this route's own label, so the two routes never
 * share a bucket. Case and whitespace variants share one bucket, the typed
 * login never reaches the limiter table, and the `:unknown:` namespace cannot
 * collide with a real `reset-password-questions:user:<id>`.
 */
function unknownLoginLimiterKey({ studentId, email }: RecoveryLogin): string {
  const digest = createHmac("sha256", getJwtSecret())
    .update(`reset-password-questions-limiter:${email ?? studentId}`)
    .digest("hex");
  return `reset-password-questions:unknown:${digest}`;
}

/** The account a typed login names, by student ID or email, with its stored answers. */
function findRecoveryAccount({ studentId, email }: RecoveryLogin) {
  return prisma.student.findFirst({
    where: email
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
}

type RecoveryAccount = NonNullable<Awaited<ReturnType<typeof findRecoveryAccount>>>;

/**
 * What the per-account limiter says about an attempt:
 *  - `open`: the attempt is inside the limit and its answers may be checked.
 *  - `locked`: the limit is spent for this window.
 *  - `unavailable`: the limiter's store is down and it failed open. No guess
 *    can be counted, so no answer may be checked.
 */
type AccountGate = "open" | "locked" | "unavailable";

/**
 * Recorded once, when the last admitted attempt lands: every later request
 * is refused and writes nothing, so a flood of guesses cannot fill the audit
 * table or the log (audit S2).
 */
async function recordLockout(studentId: string, ip: string, resetTime: number): Promise<void> {
  logger.warn("Security-question reset attempts exhausted for the window", {
    student: studentLogKey(studentId),
  });
  await logAuditEvent({
    actorId: null,
    actorRole: null,
    action: "auth.password.reset.security_questions_locked_out",
    targetType: "student",
    targetId: studentId,
    summary:
      "Classroom recovery used its last answer attempt for this window; further attempts are refused until the window resets.",
    metadata: { ip, resetAt: new Date(resetTime).toISOString() },
  });
}

/**
 * Per-account limit, keyed on the target account. The login is not a secret,
 * so answers get guessed from anywhere; counting here, before the answers are
 * checked, means every guess spends the budget.
 *
 * A locked account answers exactly like an unknown one or a wrong answer.
 * This route is reachable without a session, so a distinct 429 would confirm
 * the account exists (audit S1 on PR #196). The attempt is still counted, the
 * lockout is recorded once per window, and the running total stays visible in
 * the rate-limit table.
 *
 * The limiter round trip runs for unknown logins too (A1 security review): it
 * ran only for real accounts, so they answered one database round trip
 * slower, which the dummy KDF could not hide. A real account stays keyed on
 * its id, so its email and student-ID forms share one budget. The
 * unknown-login key is computed on every request so both paths do the same
 * work and fail alike. An unknown login can never recover, so its spent
 * bucket changes nothing it is told.
 *
 * FAILS CLOSED. `rateLimit()` admits the caller when its store is down. This
 * route sets a password and issues a session, so a degraded answer here means
 * `unavailable`, never `open`: an outage must block recovery, not uncount it.
 */
async function countAccountAttempt(
  student: RecoveryAccount | null,
  login: RecoveryLogin,
  ip: string,
): Promise<AccountGate> {
  const unknownLoginKey = unknownLoginLimiterKey(login);
  const accountRl = await rateLimit(
    student ? `reset-password-questions:user:${student.id}` : unknownLoginKey,
    ACCOUNT_LIMIT_ATTEMPTS,
    ACCOUNT_LIMIT_WINDOW_MS,
  );
  if (accountRl.degraded) return "unavailable";
  if (!accountRl.success) return "locked";
  if (student && accountRl.remaining === 0) await recordLockout(student.id, ip, accountRl.resetTime);
  return "open";
}

/** The refusal a closed gate answers with, or null when the answers may be checked. */
function gateRefusal(gate: AccountGate, answers: SecurityQuestionAnswers): NextResponse | null {
  switch (gate) {
    case "open":
      return null;
    case "locked":
      // Same KDF work as every other refusal, so a locked account is not
      // answered faster than an unknown one.
      verifyEveryAnswer(answers, NO_STORED_ANSWERS);
      return resetRefused();
    case "unavailable":
      // Every login reads this, real or unknown, and no answer was checked,
      // so there is no account and no KDF work for the response to give away.
      logger.warn("Classroom recovery refused: the per-account limiter is unavailable", {
        alert: "recovery_limiter_unavailable",
      });
      return NextResponse.json({ error: RECOVERY_UNAVAILABLE_ERROR }, { status: 503 });
    default: {
      const _exhaustive: never = gate;
      return _exhaustive;
    }
  }
}

/**
 * The stored answers an attempt may be checked against, or null for an
 * account that cannot recover: unknown, staff, or without a full question set.
 */
function recoverableAnswers(student: RecoveryAccount | null): ReadonlyMap<string, string> | null {
  const canRecover =
    student !== null &&
    hasConfiguredSecurityQuestionSet(student.securityQuestionAnswers.map((item) => item.questionKey)) &&
    !isStaffRole(student.role);
  return canRecover
    ? new Map(student.securityQuestionAnswers.map((item) => [item.questionKey, item.answerHash]))
    : null;
}

/** Sets the new password, ends the account's other sessions and cancels any emailed reset link. */
async function setNewPassword(studentId: string, password: string) {
  const { hash } = hashPassword(password);
  const result = await prisma.$transaction(async (tx) => {
    const updatedStudent = await tx.student.update({
      where: { id: studentId },
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
      where: { studentId },
    });

    return updatedStudent;
  });
  invalidateSessionCache(result.id);
  return result;
}

/** Issues the session for the account whose password was just reset, and records the reset. */
async function signInAfterReset(account: Awaited<ReturnType<typeof setNewPassword>>, ip: string): Promise<void> {
  await setSessionCookie(account.id, account.role, account.sessionVersion);
  await logAuditEvent({
    actorId: account.id,
    actorRole: account.role,
    action: "auth.password.reset.security_questions",
    targetType: "student",
    targetId: account.id,
    summary: "Student reset their password with classroom recovery questions.",
    metadata: { ip },
  });
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = clientIpBucket(req);
  // Every attempt takes a unit first, in one atomic statement, so a burst of
  // guesses cannot race past the limit. A recovery that works gives it back.
  const networkKey = `reset-password-questions:${ip}`;
  const networkRl = await rateLimit(networkKey, NETWORK_FAILED_ATTEMPT_LIMIT, NETWORK_LIMIT_WINDOW_MS);
  if (!networkRl.success) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, resetPasswordQuestionsSchema);
  const securityQuestionsResult = validateSecurityQuestionAnswers(body.securityQuestions);
  if (securityQuestionsResult.error) {
    return NextResponse.json({ error: securityQuestionsResult.error }, { status: 400 });
  }

  const login = normalizeRecoveryLogin(body.login.trim());
  const student = await findRecoveryAccount(login);
  const refusal = gateRefusal(await countAccountAttempt(student, login, ip), securityQuestionsResult.answers);
  if (refusal) return refusal;

  // Unknown, unconfigured, and staff accounts are refused only after the same
  // three KDF runs a real attempt costs, and with the same response as a
  // wrong answer: a fast reply or a distinct status would confirm the login.
  const storedAnswers = recoverableAnswers(student);
  const answersMatch = verifyEveryAnswer(securityQuestionsResult.answers, storedAnswers ?? NO_STORED_ANSWERS);
  if (!student || !storedAnswers || !answersMatch) {
    return resetRefused();
  }

  const result = await setNewPassword(student.id, body.password.trim());

  // The answers were right and the password is changed; the response says
  // so. Give the network unit back here and nowhere earlier: every refusal
  // above answers the same way whatever the answers were, so a unit that
  // came back for a locked account would let the caller read "right
  // answers" off the network count, past the per-account lock. A degraded
  // limiter took no unit, so there is nothing to give back.
  if (!networkRl.degraded) {
    await refundRateLimit(networkKey, networkRl.resetTime);
  }

  await signInAfterReset(result, ip);
  return NextResponse.json({ ok: true });
});
