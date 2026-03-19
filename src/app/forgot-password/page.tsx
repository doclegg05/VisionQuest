"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import BrandLockup from "@/components/ui/BrandLockup";
import SecurityQuestionAnswerFields from "@/components/auth/SecurityQuestionAnswerFields";
import { createEmptySecurityQuestionAnswers } from "@/lib/security-questions";

type RecoveryMode = "questions" | "email";
type RecoveryStatus = "idle" | "submitting" | "success" | "error";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [mode, setMode] = useState<RecoveryMode>("questions");
  const [login, setLogin] = useState("");
  const [securityQuestions, setSecurityQuestions] = useState(createEmptySecurityQuestionAnswers());
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<RecoveryStatus>("idle");
  const [message, setMessage] = useState("");

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "We could not start the reset process.");
        return;
      }

      setStatus("success");
      setMessage(data.message || "Check your email for a reset link.");
    } catch {
      setStatus("error");
      setMessage("We could not contact the server. Please try again.");
    }
  }

  async function handleQuestionSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (password.length < 6) {
      setStatus("error");
      setMessage("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/auth/reset-password/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login,
          password,
          securityQuestions,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "We could not verify those recovery answers.");
        return;
      }

      router.push("/chat");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("We could not contact the server. Please try again.");
    }
  }

  return (
    <main className="relative min-h-screen px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-2xl items-center">
        <section className="panel panel-strong w-full rounded-[2rem] p-6 md:p-8">
          <BrandLockup size="sm" subtitle="SPOKES Program Portal" />
          <p className="page-eyebrow text-[var(--ink-muted)]">Account recovery</p>
          <h1 className="mt-3 font-display text-4xl text-[var(--ink-strong)]">Reset your password</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
            Use an email link or answer the classroom recovery questions tied to your account.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-[rgba(16,37,62,0.06)] p-1.5">
            <button
              type="button"
              onClick={() => {
                setMode("questions");
                setMessage("");
                setStatus("idle");
              }}
              className={`rounded-[1rem] px-4 py-3 text-sm font-semibold transition-colors ${
                mode === "questions"
                  ? "bg-white text-[var(--ink-strong)] shadow-[0_14px_34px_rgba(16,37,62,0.08)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              }`}
            >
              Classroom questions
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("email");
                setMessage("");
                setStatus("idle");
              }}
              className={`rounded-[1rem] px-4 py-3 text-sm font-semibold transition-colors ${
                mode === "email"
                  ? "bg-white text-[var(--ink-strong)] shadow-[0_14px_34px_rgba(16,37,62,0.08)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              }`}
            >
              Email link
            </button>
          </div>

          {mode === "questions" ? (
            <form onSubmit={handleQuestionSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="question-login" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                  Email or Student ID
                </label>
                <input
                  id="question-login"
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="you@example.com or student ID"
                  required
                  className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>

              <SecurityQuestionAnswerFields
                answers={securityQuestions}
                onChange={setSecurityQuestions}
                idPrefix="forgot-password-security-question"
                title="Classroom recovery questions"
                description="This is a lower-security recovery option intended only for your classroom's internal VisionQuest deployment."
              />

              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>

              {message && (
                <p
                  role="alert"
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    status === "error"
                      ? "bg-red-50 text-red-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={status === "submitting"}
                className="primary-button w-full px-6 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "submitting" ? "Checking..." : "Reset with classroom questions"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmailSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email-login" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                  Email or Student ID
                </label>
                <input
                  id="email-login"
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="you@example.com or student ID"
                  required
                  className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>

              {message && (
                <p
                  role="alert"
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    status === "error"
                      ? "bg-red-50 text-red-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={status === "submitting"}
                className="primary-button w-full px-6 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "submitting" ? "Sending..." : "Send reset link"}
              </button>
            </form>
          )}

          <Link
            href="/"
            className="mt-5 inline-block text-sm font-medium text-[var(--accent-strong)] transition-colors hover:text-[var(--ink-strong)]"
          >
            Back to sign in
          </Link>
        </section>
      </div>
    </main>
  );
}
