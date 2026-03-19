"use client";

import { useState } from "react";
import Link from "next/link";

interface WelcomeFlowProps {
  studentName: string;
}

export default function WelcomeFlow({ studentName }: WelcomeFlowProps) {
  const [step, setStep] = useState(0);

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-lg">
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
                {
                  icon: "💬",
                  text: "Chat with Sage, your AI coach, to set goals and get guidance",
                },
                {
                  icon: "🏆",
                  text: "Earn certifications in digital literacy, office skills, customer service, and more",
                },
                {
                  icon: "💼",
                  text: "Build a portfolio that proves you're ready to work",
                },
              ].map((item) => (
                <div
                  key={item.text}
                  className="flex items-start gap-3 rounded-xl bg-white/60 p-3"
                >
                  <span className="text-xl">{item.icon}</span>
                  <p className="text-sm text-[var(--ink-strong)]">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
            <button
              onClick={() => setStep(1)}
              className="primary-button mt-8 px-8 py-3 text-sm"
            >
              Let&apos;s get started →
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">🧙‍♂️</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">
              Meet Sage
            </h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              Sage is your AI mentor — like a supportive friend who helps you
              plan, stay motivated, and make progress toward your goals.
            </p>
            <div className="mt-8 space-y-3 text-left">
              {[
                {
                  icon: "🎯",
                  text: "Help you define your big dream and break it into steps",
                },
                {
                  icon: "📋",
                  text: "Guide you through orientation and paperwork",
                },
                {
                  icon: "🔥",
                  text: "Check in daily and celebrate your wins",
                },
                {
                  icon: "❓",
                  text: "Answer questions about certifications, platforms, and the program",
                },
              ].map((item) => (
                <div
                  key={item.text}
                  className="flex items-start gap-3 rounded-xl bg-white/60 p-3"
                >
                  <span className="text-xl">{item.icon}</span>
                  <p className="text-sm text-[var(--ink-strong)]">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
            <button
              onClick={() => setStep(2)}
              className="primary-button mt-8 px-8 py-3 text-sm"
            >
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

        {step === 2 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">🚀</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">
              Your first step
            </h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              Choose where you&apos;d like to start. You can always find
              everything on your dashboard.
            </p>
            <div className="mt-8 space-y-3">
              <Link
                href="/chat"
                className="group flex items-start gap-4 rounded-[1.5rem] border-2 border-[var(--accent-strong)] bg-white/80 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--ink-strong)] text-2xl text-white">
                  💬
                </span>
                <div>
                  <p className="font-display text-lg text-[var(--ink-strong)]">
                    Talk to Sage
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Start a conversation about your dreams and goals. Sage will
                    help you turn them into a plan.
                  </p>
                </div>
              </Link>
              <Link
                href="/orientation"
                className="group flex items-start gap-4 rounded-[1.5rem] border border-[var(--border)] bg-white/60 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--ink-strong)] text-2xl text-white">
                  📋
                </span>
                <div>
                  <p className="font-display text-lg text-[var(--ink-strong)]">
                    Complete Orientation
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Review program forms and get oriented with what to expect.
                  </p>
                </div>
              </Link>
              <Link
                href="/dashboard"
                className="group flex items-start gap-4 rounded-[1.5rem] border border-[var(--border)] bg-white/60 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--ink-strong)] text-2xl text-white">
                  📊
                </span>
                <div>
                  <p className="font-display text-lg text-[var(--ink-strong)]">
                    Explore the Dashboard
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    See all the modules available and find your own path.
                  </p>
                </div>
              </Link>
            </div>
            <button
              onClick={() => setStep(1)}
              className="mt-4 text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Step indicator dots */}
        <div className="mt-8 flex justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === step
                  ? "w-6 bg-[var(--accent-strong)]"
                  : "w-2 bg-[rgba(18,38,63,0.15)]"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
