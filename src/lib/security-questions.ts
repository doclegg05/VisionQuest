export const SECURITY_QUESTIONS = [
  { key: "birth_city", prompt: "What city were you born in?" },
  { key: "elementary_school", prompt: "What was the name of your elementary school?" },
  { key: "favorite_teacher", prompt: "What is the first name of a favorite teacher?" },
] as const;

export type SecurityQuestionKey = (typeof SECURITY_QUESTIONS)[number]["key"];

export type SecurityQuestionAnswers = Record<SecurityQuestionKey, string>;

export const SECURITY_ANSWER_MAX_LENGTH = 200;

export function createEmptySecurityQuestionAnswers(): SecurityQuestionAnswers {
  return {
    birth_city: "",
    elementary_school: "",
    favorite_teacher: "",
  };
}

export function normalizeSecurityAnswer(answer: string): string {
  return answer
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function validateSecurityQuestionAnswers(raw: unknown): {
  answers: SecurityQuestionAnswers;
  error: string | null;
} {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const answers = createEmptySecurityQuestionAnswers();

  for (const question of SECURITY_QUESTIONS) {
    const rawValue = input[question.key];
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) {
      return {
        answers,
        error: "Answer all three classroom recovery questions.",
      };
    }
    if (value.length > SECURITY_ANSWER_MAX_LENGTH) {
      return {
        answers,
        error: `Recovery answers must be ${SECURITY_ANSWER_MAX_LENGTH} characters or fewer.`,
      };
    }
    if (normalizeSecurityAnswer(value).length < 2) {
      return {
        answers,
        error: "Each recovery answer must contain at least 2 letters or numbers.",
      };
    }
    answers[question.key] = value;
  }

  return { answers, error: null };
}

export function hasConfiguredSecurityQuestionSet(questionKeys: string[]): boolean {
  if (questionKeys.length !== SECURITY_QUESTIONS.length) {
    return false;
  }

  const configured = new Set(questionKeys);
  return SECURITY_QUESTIONS.every((question) => configured.has(question.key));
}
