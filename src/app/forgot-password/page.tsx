"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [login, setLogin] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
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

      setStatus("sent");
      setMessage(data.message || "Check your email for a reset link.");
    } catch {
      setStatus("error");
      setMessage("We could not contact the server. Please try again.");
    }
  }

  return (
    <main className="relative min-h-screen px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-2xl items-center">
        <section className="panel panel-strong w-full rounded-[2rem] p-6 md:p-8">
          <p className="page-eyebrow text-[var(--muted)]">Account recovery</p>
          <h1 className="mt-3 font-display text-4xl text-[var(--ink-strong)]">Reset your password</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Enter your email address or student ID. If your account has an email on file, we will send you a reset link.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Email or Student ID
              </label>
              <input
                id="login"
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
