import { hashPassword, verifyPasswordSafe } from "./auth";
import type { SecurityQuestionAnswers, SecurityQuestionKey } from "./security-questions";
import { normalizeSecurityAnswer } from "./security-questions";

export function hashSecurityAnswer(answer: string): string {
  return hashPassword(normalizeSecurityAnswer(answer)).hash;
}

/**
 * Always runs the KDF, even with no usable stored hash (it checks against a
 * dummy one and never matches), so the time a check takes does not show
 * whether a stored answer exists.
 */
export function verifySecurityAnswer(answer: string, storedHash: string | null | undefined): boolean {
  return verifyPasswordSafe(normalizeSecurityAnswer(answer), storedHash);
}

export function hashSecurityAnswers(answers: SecurityQuestionAnswers) {
  return Object.entries(answers).map(([questionKey, answer]) => ({
    questionKey: questionKey as SecurityQuestionKey,
    answerHash: hashSecurityAnswer(answer),
  }));
}
