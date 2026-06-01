"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SecurityQuestionAnswerFields from "@/components/auth/SecurityQuestionAnswerFields";
import {
  createEmptySecurityQuestionAnswers,
  type SecurityQuestionAnswers,
} from "@/lib/security-questions";

interface RecoverySetupFormProps {
  /** Where to send the student after they finish setup. */
  redirectTo: string;
}

export default function RecoverySetupForm({ redirectTo }: RecoverySetupFormProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<SecurityQuestionAnswers>(
    createEmptySecurityQuestionAnswers(),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError("");

    try {
      const res = await fetch("/api/settings/security-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ securityQuestions: answers }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setStatus("error");
        setError(data?.error || "We could not save your recovery questions. Please try again.");
        return;
      }

      // Configured now — leave the gate. replace() so Back doesn't return here.
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setStatus("error");
      setError("We could not contact the server. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <SecurityQuestionAnswerFields
        answers={answers}
        disabled={status === "saving"}
        onChange={setAnswers}
        title="Set up your account recovery"
        description="Answer these three questions. If you ever forget your password, you'll use them to get back into your account. Pick answers you'll always remember."
      />

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "saving"}
        className="primary-button w-full px-6 py-3 text-sm disabled:opacity-50"
      >
        {status === "saving" ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
