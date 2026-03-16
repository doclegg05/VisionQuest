import { hashPassword, verifyPassword } from "./auth";
import type { SecurityQuestionAnswers, SecurityQuestionKey } from "./security-questions";
import { normalizeSecurityAnswer } from "./security-questions";

export function hashSecurityAnswer(answer: string): string {
  return hashPassword(normalizeSecurityAnswer(answer)).hash;
}

export function verifySecurityAnswer(answer: string, storedHash: string): boolean {
  return verifyPassword(normalizeSecurityAnswer(answer), storedHash);
}

export function hashSecurityAnswers(answers: SecurityQuestionAnswers) {
  return Object.entries(answers).map(([questionKey, answer]) => ({
    questionKey: questionKey as SecurityQuestionKey,
    answerHash: hashSecurityAnswer(answer),
  }));
}
