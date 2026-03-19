"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import BrandLockup from "@/components/ui/BrandLockup";

export default function TeacherRegisterPage() {
  const [teacherKey, setTeacherKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register-teacher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherKey, displayName, email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      router.push("/teacher");
      router.refresh();
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-xl items-center">
        <div className="panel panel-strong w-full rounded-[2rem] p-6 md:p-10">
          <div className="mb-8">
            <BrandLockup size="sm" subtitle="SPOKES Program Portal" />
            <p className="page-eyebrow text-[var(--ink-muted)]">Teacher access</p>
            <h1 className="mt-3 font-display text-3xl text-[var(--ink-strong)]">
              Teacher Registration
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              Create a teacher account for the SPOKES Program Portal.
              You will need the teacher registration key provided by your administrator.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" aria-label="Teacher registration">
            <div>
              <label htmlFor="teacherKey" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Teacher Key
              </label>
              <input
                id="teacherKey"
                type="password"
                value={teacherKey}
                onChange={(e) => setTeacherKey(e.target.value)}
                placeholder="Enter the teacher registration key"
                required
                className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Contact your program administrator if you don&apos;t have this key.
              </p>
            </div>

            <div>
              <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Full Name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your full name"
                required
                className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                autoComplete="new-password"
                className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                required
                autoComplete="new-password"
                className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="primary-button w-full px-6 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Creating account..." : "Create Teacher Account"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="text-sm font-medium text-[var(--accent-strong)] transition-colors hover:text-[var(--ink-strong)]"
            >
              Back to student sign-in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
