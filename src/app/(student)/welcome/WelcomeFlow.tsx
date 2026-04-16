"use client";

import { useState } from "react";
import Link from "next/link";

interface QuickWinItem {
  id: string;
  label: string;
  description: string | null;
}

interface WelcomeFlowProps {
  studentName: string;
  quickWinItems?: QuickWinItem[];
}

const TOTAL_STEPS = 4;

export default function WelcomeFlow({ studentName, quickWinItems = [] }: WelcomeFlowProps) {
  const [step, setStep] = useState(0);
  const [completedWins, setCompletedWins] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [showScore, setShowScore] = useState(false);

  const hasQuickWins = quickWinItems.length > 0;
  const allWinsDone = hasQuickWins && completedWins.size >= quickWinItems.length;
  const scorePct = hasQuickWins
    ? Math.round((completedWins.size / 24) * 100) // ~24 total orientation items
    : 0;

  async function completeQuickWin(itemId: string) {
    setSaving(itemId);
    try {
      const res = await fetch("/api/orientation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, completed: true }),
      });
      if (res.ok) {
        setCompletedWins((prev) => new Set(prev).add(itemId));
        // If all done, show score animation briefly
        if (completedWins.size + 1 >= quickWinItems.length) {
          setShowScore(true);
          setTimeout(() => setStep(3), 2000);
        }
      }
    } catch {
      // Silent fail — they can retry
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">🌟</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">
              Welcome, {studentName}!
            </h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              VisionQuest is your personal guide through the SPOKES program —
              from setting goals to earning certifications and building your
              career.
            </p>
            <div className="mt-8 space-y-3 text-left">
              {[
                { icon: "📋", text: "Complete orientation forms and get set up for the program" },
                { icon: "🎯", text: "Set career goals and track your progress with AI coaching" },
                { icon: "🏆", text: "Earn industry certifications and build your professional portfolio" },
              ].map((item) => (
                <div key={item.text} className="flex items-start gap-3 rounded-xl bg-[var(--surface-raised)] p-3">
                  <span className="text-xl">{item.icon}</span>
                  <p className="text-sm text-[var(--ink-strong)]">{item.text}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setStep(1)} className="primary-button mt-8 px-8 py-3 text-sm">
              Let&apos;s get started →
            </button>
          </div>
        )}

        {/* Step 1: Meet Sage */}
        {step === 1 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">🧙‍♂️</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">Meet Sage</h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              Sage is your AI mentor — like a supportive friend who helps you
              plan, stay motivated, and make progress toward your goals.
            </p>
            <div className="mt-8 space-y-3 text-left">
              {[
                { icon: "🎯", text: "Help you define your big dream and break it into steps" },
                { icon: "📋", text: "Guide you through orientation and paperwork" },
                { icon: "🔥", text: "Check in daily and celebrate your wins" },
                { icon: "❓", text: "Answer questions about certifications, platforms, and the program" },
              ].map((item) => (
                <div key={item.text} className="flex items-start gap-3 rounded-xl bg-[var(--surface-raised)] p-3">
                  <span className="text-xl">{item.icon}</span>
                  <p className="text-sm text-[var(--ink-strong)]">{item.text}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setStep(2)} className="primary-button mt-8 px-8 py-3 text-sm">
              Next →
            </button>
            <button
              onClick={() => setStep(0)}
              className="mx-auto mt-3 block text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Step 2: Quick Wins */}
        {step === 2 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">⚡</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">Your first wins</h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              {hasQuickWins
                ? "Let's knock out a few quick orientation items right now. These take just a moment."
                : "You're all set! Let's choose where you'd like to start."}
            </p>

            {hasQuickWins && (
              <div className="mt-8 space-y-3 text-left">
                {quickWinItems.map((item) => {
                  const done = completedWins.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 rounded-xl border p-4 transition-colors ${
                        done
                          ? "border-green-200 bg-green-50"
                          : "border-[var(--border)] bg-[var(--surface-raised)]"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${done ? "text-green-800" : "text-[var(--ink-strong)]"}`}>
                          {done && <span className="mr-1.5">✓</span>}
                          {item.label}
                        </p>
                        {item.description && (
                          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{item.description}</p>
                        )}
                      </div>
                      {!done && (
                        <button
                          onClick={() => completeQuickWin(item.id)}
                          disabled={saving === item.id}
                          className="shrink-0 rounded-full bg-[var(--accent-strong)] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent)] disabled:opacity-60"
                        >
                          {saving === item.id ? "Saving..." : "I've read this"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Score animation after all wins */}
            {showScore && (
              <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4">
                <p className="text-sm font-medium text-green-800">
                  🎉 Nice! Your readiness score is already at {scorePct}%
                </p>
                <div className="mt-2 h-2 rounded-full bg-green-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-1000"
                    style={{ width: `${scorePct}%` }}
                  />
                </div>
              </div>
            )}

            {!showScore && (
              <div className="mt-8 flex flex-col items-center gap-3">
                {hasQuickWins && !allWinsDone ? (
                  <button
                    onClick={() => setStep(3)}
                    className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                  >
                    Skip for now →
                  </button>
                ) : (
                  <button onClick={() => setStep(3)} className="primary-button px-8 py-3 text-sm">
                    {hasQuickWins ? "Continue →" : "Next →"}
                  </button>
                )}
                <button
                  onClick={() => setStep(1)}
                  className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                >
                  ← Back
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Choose your path */}
        {step === 3 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">🚀</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">Your first step</h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              Choose where you&apos;d like to start. You can always find
              everything on your dashboard.
            </p>
            <div className="mt-8 space-y-3">
              <Link
                href="/chat"
                className="group flex items-start gap-4 rounded-[1.5rem] border-2 border-[var(--accent-strong)] bg-[var(--surface-raised)] p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--ink-strong)] text-2xl text-white">
                  💬
                </span>
                <div>
                  <p className="font-display text-lg text-[var(--ink-strong)]">Talk to Sage</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Start a conversation about your dreams and goals. Sage will help you turn them into a plan.
                  </p>
                </div>
              </Link>
              <Link
                href="/orientation"
                className="group flex items-start gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface-raised)] p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--ink-strong)] text-2xl text-white">
                  📋
                </span>
                <div>
                  <p className="font-display text-lg text-[var(--ink-strong)]">Complete Orientation</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Review program forms and get oriented with what to expect.
                  </p>
                </div>
              </Link>
              <Link
                href="/dashboard"
                className="group flex items-start gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface-raised)] p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--ink-strong)] text-2xl text-white">
                  📊
                </span>
                <div>
                  <p className="font-display text-lg text-[var(--ink-strong)]">Explore the Dashboard</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    See all the modules available and find your own path.
                  </p>
                </div>
              </Link>
            </div>
            <button
              onClick={() => setStep(2)}
              className="mt-4 text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Step indicator dots */}
        <div className="mt-8 flex justify-center gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === step
                  ? "w-6 bg-[var(--accent-strong)]"
                  : "w-2 bg-[var(--surface-muted)]"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
