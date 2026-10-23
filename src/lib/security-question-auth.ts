import { hashPassword, verifyPasswordSafe } from "./auth";
import type { SecurityQuestionAnswers, SecurityQuestionKey } from "./security-questions";
import { normalizeSecurityAnswer } from "./security-questions";

export function hashSecurityAnswer(answer: string): string {
  return hashPassword(normalizeSecurityAnswer(answer)).hash;
}

/**
 * Always runs the KDF. A missing or unusable stored hash is checked against
 * auth's dummy hash and never matches, so a caller can spend the same time on
 * an answer whether or not there is a real hash behind it.
 */
export function verifySecurityAnswer(
  answer: string,
  storedHash: string | null | undefined,
): boolean {
  return verifyPasswordSafe(normalizeSecurityAnswer(answer), storedHash);
}

export function hashSecurityAnswers(answers: SecurityQuestionAnswers) {
  return Object.entries(answers).map(([questionKey, answer]) => ({
    questionKey: questionKey as SecurityQuestionKey,
    answerHash: hashSecurityAnswer(answer),
  }));
}
