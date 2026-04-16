"use client";

import type { SecurityQuestionAnswers, SecurityQuestionKey } from "@/lib/security-questions";
import { SECURITY_QUESTIONS } from "@/lib/security-questions";

interface SecurityQuestionAnswerFieldsProps {
  answers: SecurityQuestionAnswers;
  disabled?: boolean;
  idPrefix?: string;
  title?: string;
  description?: string;
  onChange: (next: SecurityQuestionAnswers) => void;
}

export default function SecurityQuestionAnswerFields({
  answers,
  disabled = false,
  idPrefix = "security-question",
  title = "Classroom recovery questions",
  description = "These lower-security questions are only for this classroom deployment. You'll use them if you forget your password.",
  onChange,
}: SecurityQuestionAnswerFieldsProps) {
  function updateAnswer(questionKey: SecurityQuestionKey, value: string) {
    onChange({
      ...answers,
      [questionKey]: value,
    });
  }

  return (
    <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="mb-4">
        <p className="text-sm font-semibold text-[var(--ink-strong)]">{title}</p>
        <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{description}</p>
      </div>

      <div className="space-y-4">
        {SECURITY_QUESTIONS.map((question, index) => (
          <div key={question.key}>
            <label
              htmlFor={`${idPrefix}-${question.key}`}
              className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]"
            >
              {index + 1}. {question.prompt}
            </label>
            <input
              id={`${idPrefix}-${question.key}`}
              type="text"
              value={answers[question.key]}
              onChange={(event) => updateAnswer(question.key, event.target.value)}
              disabled={disabled}
              required
              autoComplete="off"
              className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
