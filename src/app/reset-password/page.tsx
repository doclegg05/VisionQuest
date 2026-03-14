"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLockup from "@/components/ui/BrandLockup";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!token) {
      setStatus("error");
      setMessage("This reset link is missing or invalid.");
      return;
    }

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
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "We could not reset your password.");
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
    <section className="panel panel-strong w-full rounded-[2rem] p-6 md:p-8">
      <BrandLockup size="sm" subtitle="SPOKES Program Portal" />
      <p className="page-eyebrow text-[var(--muted)]">Account recovery</p>
      <h1 className="mt-3 font-display text-4xl text-[var(--ink-strong)]">Choose a new password</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        Create a new password for your VisionQuest account. You will be signed in right after the reset succeeds.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
            New password
          </label>
          <input
            id="password"
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
            Confirm password
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
          <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="primary-button w-full px-6 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" ? "Resetting..." : "Reset password"}
        </button>
      </form>

      <Link
        href="/"
        className="mt-5 inline-block text-sm font-medium text-[var(--accent-strong)] transition-colors hover:text-[var(--ink-strong)]"
      >
        Back to sign in
      </Link>
    </section>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="relative min-h-screen px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-2xl items-center">
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
