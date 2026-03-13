"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured: "Google sign-in is not set up here. Use the form below to register or sign in.",
  oauth_denied: "Google sign-in was cancelled. You can still use the form below.",
  oauth_invalid: "Google sign-in returned an invalid response. Please try again or use the form below.",
  oauth_state_mismatch: "Google sign-in session expired. Please try again or use the form below.",
  oauth_token_failed: "Google sign-in failed to authenticate. Please try again or use the form below.",
  oauth_userinfo_failed: "Could not retrieve your Google account info. Please try again or use the form below.",
  oauth_failed: "Google sign-in failed. Please try again or use the form below.",
  auth_failed: "Google sign-in failed. Please try again or use the form below.",
};

const HIGHLIGHTS = [
  "AI coaching that turns big goals into weekly and daily action.",
  "A calm student portal for courses, certifications, files, and portfolios.",
  "Teacher tools that keep progress visible without overwhelming learners.",
];

const MODULE_SPOTLIGHT = [
  { icon: "🎯", label: "Goal mapping", copy: "From BHAG to today’s next step." },
  { icon: "📚", label: "Learning hub", copy: "Courses and certifications in one place." },
  { icon: "💼", label: "Career proof", copy: "Portfolio, resume, and ready-to-share wins." },
];

type Mode = "login" | "register";

interface AuthPageClientProps {
  googleAuthEnabled: boolean;
}

function AuthForm({ googleAuthEnabled }: AuthPageClientProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [studentId, setStudentId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const oauthError = searchParams.get("error");
  const oauthErrorMessage = oauthError ? (ERROR_MESSAGES[oauthError] || "An error occurred. Please try again.") : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body: Record<string, string> = { studentId, password };
      if (mode === "register") {
        body.displayName = displayName;
        body.email = email;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      router.push("/chat");
      router.refresh();
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" className="relative min-h-screen px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-7xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(7,23,43,0.94),rgba(15,154,146,0.76)_56%,rgba(255,154,77,0.64))] p-8 text-white shadow-[0_32px_120px_rgba(7,23,43,0.25)] md:p-10 lg:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_18%,rgba(255,223,159,0.26),transparent_24%),radial-gradient(circle_at_85%_12%,rgba(255,255,255,0.14),transparent_20%)]" />
          <div className="relative flex h-full flex-col">
            <div className="max-w-2xl">
              <p className="page-eyebrow">SPOKES workforce development</p>
              <h1 className="mt-4 font-display text-[clamp(2.7rem,5vw,5rem)] leading-[0.96] tracking-[-0.06em]">
                Build momentum, one brave step at a time.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-white/80 md:text-lg">
                Visionquest gives students a grounded, hopeful place to set goals,
                stay organized, and keep moving toward work, stability, and self-sufficiency.
              </p>
            </div>

            <div className="mt-8 grid gap-3 text-sm text-white/80 md:max-w-2xl">
              {HIGHLIGHTS.map((highlight) => (
                <div
                  key={highlight}
                  className="flex items-start gap-3 rounded-2xl border border-white/12 bg-white/10 px-4 py-3 backdrop-blur-sm"
                >
                  <span className="mt-0.5 text-[var(--accent-tertiary)]">✦</span>
                  <p>{highlight}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {MODULE_SPOTLIGHT.map((module) => (
                <div
                  key={module.label}
                  className="rounded-[1.4rem] border border-white/12 bg-[rgba(6,16,31,0.24)] p-4 backdrop-blur-sm"
                >
                  <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/14 text-xl">
                    {module.icon}
                  </div>
                  <p className="font-semibold text-white">{module.label}</p>
                  <p className="mt-1 text-sm leading-6 text-white/72">{module.copy}</p>
                </div>
              ))}
            </div>

            <div className="mt-auto grid gap-3 pt-8 sm:grid-cols-3">
              <div className="rounded-[1.5rem] border border-white/12 bg-white/10 px-4 py-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.24em] text-white/55">Sage</p>
                <p className="mt-2 text-lg font-semibold">Coaching with context</p>
              </div>
              <div className="rounded-[1.5rem] border border-white/12 bg-white/10 px-4 py-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.24em] text-white/55">Progression</p>
                <p className="mt-2 text-lg font-semibold">Wins that stay visible</p>
              </div>
              <div className="rounded-[1.5rem] border border-white/12 bg-white/10 px-4 py-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.24em] text-white/55">Portfolio</p>
                <p className="mt-2 text-lg font-semibold">Proof of readiness</p>
              </div>
            </div>
          </div>
        </section>

        <section className="panel panel-strong flex items-center rounded-[2rem] p-5 md:p-8">
          <div className="w-full">
            <div className="mb-8">
              <p className="page-eyebrow text-[var(--muted)]">Portal access</p>
              <h2 className="mt-3 font-display text-3xl text-[var(--ink-strong)]">
                {mode === "login" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Use the form below to register or sign in. Google sign-in is optional, not required, and new accounts use email-based recovery.
              </p>
            </div>

            {oauthErrorMessage && (
              <div
                role="alert"
                className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {oauthErrorMessage}
              </div>
            )}

            <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-[rgba(16,37,62,0.06)] p-1.5">
              <button
                type="button"
                onClick={() => { setMode("login"); setError(""); }}
                className={`rounded-[1rem] px-4 py-3 text-sm font-semibold transition-colors
                  ${mode === "login"
                    ? "bg-white text-[var(--ink-strong)] shadow-[0_14px_34px_rgba(16,37,62,0.08)]"
                    : "text-[var(--muted)] hover:text-[var(--ink-strong)]"
                  }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setMode("register"); setError(""); }}
                className={`rounded-[1rem] px-4 py-3 text-sm font-semibold transition-colors
                  ${mode === "register"
                    ? "bg-white text-[var(--ink-strong)] shadow-[0_14px_34px_rgba(16,37,62,0.08)]"
                    : "text-[var(--muted)] hover:text-[var(--ink-strong)]"
                  }`}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" aria-label={mode === "login" ? "Sign in" : "Create account"}>
              <div>
                <label htmlFor="studentId" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">Student ID</label>
                <input
                  id="studentId"
                  type="text"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="e.g., john.doe"
                  autoComplete="username"
                  required
                  className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>

              {mode === "register" && (
                <div>
                  <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">Your Name</label>
                  <input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="What should we call you?"
                    required
                    className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                  />
                </div>
              )}

              {mode === "register" && (
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">Email</label>
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
              )}

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="field px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="primary-button w-full px-6 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
              </button>

              {mode === "login" && (
                <a
                  href="/forgot-password"
                  className="block text-center text-sm font-medium text-[var(--accent-strong)] transition-colors hover:text-[var(--ink-strong)]"
                >
                  Forgot your password?
                </a>
              )}
            </form>

            {googleAuthEnabled ? (
              <>
                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-[rgba(18,38,63,0.12)]" />
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">or</span>
                  <div className="h-px flex-1 bg-[rgba(18,38,63,0.12)]" />
                </div>

                <a
                  href="/api/auth/google"
                  className="flex w-full items-center justify-center gap-3 rounded-[1rem] border border-[rgba(18,38,63,0.14)]
                             bg-white px-4 py-3 text-base font-semibold text-[var(--ink-strong)] transition-colors
                             hover:bg-[rgba(16,37,62,0.04)]"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </a>
              </>
            ) : (
              <div className="mt-5 rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[rgba(16,37,62,0.04)] px-4 py-3 text-sm text-[var(--muted)]">
                Google sign-in is not enabled in this environment. Use the register or sign-in form above.
              </div>
            )}

            <div className="mt-6 flex flex-col items-center gap-2">
              <a
                href="/teacher-register"
                className="text-sm font-medium text-[var(--accent-strong)] transition-colors hover:text-[var(--ink-strong)]"
              >
                Teacher? Register here
              </a>
              <p className="text-xs leading-5 text-[var(--muted)]">
                SPOKES Workforce Development Program
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function AuthPageClient({ googleAuthEnabled }: AuthPageClientProps) {
  return (
    <Suspense fallback={null}>
      <AuthForm googleAuthEnabled={googleAuthEnabled} />
    </Suspense>
  );
}
