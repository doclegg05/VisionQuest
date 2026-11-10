import { hashPassword, invalidateSessionCache, verifyPasswordSafeWithStatus } from "./auth";
import { prismaAdmin } from "./db";
import { logger } from "./logger";
import { rateLimit } from "./rate-limit";
import {
  ACCOUNT_FAILED_SIGN_IN_LIMIT,
  SIGN_IN_WINDOW_MINUTES,
  SIGN_IN_WINDOW_MS,
  accountSignInLimiterKey,
  giveBack,
  takenUnit,
} from "./sign-in-budget";

/**
 * A signed-in student changes their own password.
 *
 * The caller has already checked the session and parsed the body, so both
 * passwords arrive trimmed, as sign-in trims what is typed, and the new one
 * already meets the length rule. What happens here, in order:
 *
 *   1. The attempt takes one unit of the account's sign-in budget
 *      (src/lib/sign-in-budget.ts): a wrong current password is a guess at
 *      the same secret a failed sign-in guesses at, so the two share a count.
 *      A spent budget refuses before the password is looked at.
 *   2. The current password is checked with the helper sign-in uses. A wrong
 *      one keeps its unit. A right one gives it back, here and nowhere else.
 *   3. Only then are the rules that need the current password applied. "Same
 *      as the current one" compares the two typed values and never the new
 *      one against the stored hash, which would test guesses for free.
 *   4. The write is conditional on the hash and the session version that were
 *      read. A staff reset that lands in between changes both, so this write
 *      then matches no row and the reset stands.
 *
 * FAILS CLOSED when the limiter cannot count. `rateLimit()` admits the caller
 * when its store is down; this route sets a password, so an attempt that
 * cannot be counted is not checked at all.
 */

export type PasswordChangeResult =
  | { kind: "changed"; role: string; sessionVersion: number }
  | { kind: "wrong_current_password" }
  | { kind: "budget_spent" }
  | { kind: "limiter_unavailable" }
  | { kind: "no_password_set" }
  | { kind: "same_as_current" }
  | { kind: "contains_login" }
  | { kind: "changed_elsewhere" };

/** A result that is not a success: what the route turns into an error response. */
export type PasswordChangeRefusal = Exclude<PasswordChangeResult, { kind: "changed" }>;

export interface PasswordChangeRefusalResponse {
  status: number;
  code: string;
  error: string;
}

/**
 * The status, code and words for each refusal. The words are what a student
 * reads, on the forced screen and in Settings alike. A new kind of refusal
 * fails to compile until it has an entry here.
 */
const REFUSALS: Readonly<Record<PasswordChangeRefusal["kind"], PasswordChangeRefusalResponse>> = {
  wrong_current_password: {
    status: 400,
    code: "WRONG_CURRENT_PASSWORD",
    error: `That is not the password you signed in with. Check each letter and type the dashes too. After ${ACCOUNT_FAILED_SIGN_IN_LIMIT} wrong tries you must wait ${SIGN_IN_WINDOW_MINUTES} minutes.`,
  },
  budget_spent: {
    status: 429,
    code: "TOO_MANY_WRONG_TRIES",
    error: `Too many wrong tries. Wait ${SIGN_IN_WINDOW_MINUTES} minutes, then try again. Or ask your instructor for help.`,
  },
  limiter_unavailable: {
    status: 503,
    code: "PASSWORD_CHANGE_UNAVAILABLE",
    error: "We cannot change passwords right now. Try again in a few minutes, or ask your instructor for help. You can sign out and come back later.",
  },
  no_password_set: {
    status: 400,
    code: "NO_PASSWORD_SET",
    error: "This account has no password yet. Sign out, then use Forgot your password to set one.",
  },
  same_as_current: {
    status: 400,
    code: "SAME_AS_CURRENT_PASSWORD",
    error: "Your new password must be different from the one you use now.",
  },
  contains_login: {
    status: 400,
    code: "PASSWORD_CONTAINS_LOGIN",
    error: "Do not put your username in your password. Choose something else.",
  },
  changed_elsewhere: {
    status: 409,
    code: "PASSWORD_CHANGED_ELSEWHERE",
    error: "Your instructor just set a new password for you. Sign in again with it.",
  },
};

export function passwordChangeRefusal(result: PasswordChangeRefusal): PasswordChangeRefusalResponse {
  return REFUSALS[result.kind];
}

interface ChangeOwnPasswordInput {
  accountId: string;
  /** Trimmed by the caller's schema. */
  currentPassword: string;
  /** Trimmed and length-checked by the caller's schema. */
  newPassword: string;
}

/** The account as this change read it: the write below happens only if the last two still hold. */
function readAccount(accountId: string) {
  return prismaAdmin.student.findUnique({
    where: { id: accountId },
    select: { id: true, studentId: true, role: true, passwordHash: true, sessionVersion: true },
  });
}

/**
 * Sets the new hash, clears the must-change flag, ends every other session
 * and cancels pending reset links, but only if the row still holds the hash
 * and the version that were read. Answers the new session version, or null
 * when a reset or another change got there first.
 */
async function writeNewPassword(
  account: { id: string; passwordHash: string; sessionVersion: number },
  newPassword: string,
): Promise<number | null> {
  const { hash } = hashPassword(newPassword);
  const written = await prismaAdmin.$transaction(async (tx) => {
    const updated = await tx.student.updateMany({
      where: { id: account.id, passwordHash: account.passwordHash, sessionVersion: account.sessionVersion },
      data: { passwordHash: hash, mustChangePassword: false, sessionVersion: { increment: 1 } },
    });
    if (updated.count !== 1) return false;
    await tx.passwordResetToken.deleteMany({ where: { studentId: account.id } });
    return true;
  });
  if (!written) return null;
  invalidateSessionCache(account.id);
  return account.sessionVersion + 1;
}

export async function changeOwnPassword({
  accountId,
  currentPassword,
  newPassword,
}: ChangeOwnPasswordInput): Promise<PasswordChangeResult> {
  const account = await readAccount(accountId);
  // No password to check against: nothing here can be guessed, so no unit is taken.
  if (!account?.passwordHash) return { kind: "no_password_set" };
  const { passwordHash } = account;

  const budgetKey = accountSignInLimiterKey(account.id);
  const attempt = await rateLimit(budgetKey, ACCOUNT_FAILED_SIGN_IN_LIMIT, SIGN_IN_WINDOW_MS);
  if (attempt.degraded) {
    logger.warn("Password change refused: the per-account limiter is unavailable", {
      alert: "password_change_limiter_unavailable",
    });
    return { kind: "limiter_unavailable" };
  }
  if (!attempt.success) return { kind: "budget_spent" };

  if (!verifyPasswordSafeWithStatus(currentPassword, passwordHash).valid) {
    return { kind: "wrong_current_password" };
  }
  // The current password was right, and every answer from here on says so.
  await giveBack([takenUnit(budgetKey, attempt)]);

  if (newPassword === currentPassword) return { kind: "same_as_current" };
  if (newPassword.toLowerCase().includes(account.studentId.toLowerCase())) return { kind: "contains_login" };

  const sessionVersion = await writeNewPassword({ id: account.id, passwordHash, sessionVersion: account.sessionVersion }, newPassword);
  if (sessionVersion === null) return { kind: "changed_elsewhere" };
  return { kind: "changed", role: account.role, sessionVersion };
}
