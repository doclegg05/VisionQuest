"use client";

import Link from "next/link";
import { CheckCircle, Lock, Sparkle, WarningCircle, ArrowRight } from "@phosphor-icons/react";
import type { PathStep } from "@/lib/progression/student-next-step";

interface PathToEmploymentProps {
  currentStepKey: string;
  title: string;
  description: string;
  whyItMatters: string;
  actionLabel: string;
  actionLink: string;
  steps: PathStep[];
}

export function PathToEmployment({
  currentStepKey,
  title,
  description,
  whyItMatters,
  actionLabel,
  actionLink,
  steps,
}: PathToEmploymentProps) {
  return (
    <div className="surface-section p-6 rounded-2xl border border-[var(--border)] shadow-sm w-full mb-6">
      {/* Horizontal Steps Bar */}
      <nav aria-label="Employment journey path" className="w-full mb-6">
        <ol className="flex flex-wrap items-center justify-between gap-y-4 md:flex-nowrap md:gap-x-2">
          {steps.map((step, idx) => {
            const isActive = step.key === currentStepKey;
            const isComplete = step.status === "complete";
            const isLocked = step.status === "locked";
            const isBlocked = step.status === "blocked";

            return (
              <li
                key={step.key}
                className="flex items-center flex-1 min-w-[120px] md:min-w-0"
              >
                <div className="flex flex-col items-center text-center w-full relative">
                  {/* Line connector between steps */}
                  {idx > 0 && (
                    <div
                      className={`absolute top-5 left-[-50%] right-[50%] h-0.5 -z-10 hidden md:block ${
                        isLocked
                          ? "bg-slate-200 dark:bg-slate-800"
                          : isComplete
                          ? "bg-emerald-500"
                          : "bg-indigo-300 dark:bg-indigo-900/50"
                      }`}
                    />
                  )}

                  {/* Icon Indicator */}
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ${
                      isActive
                        ? "bg-indigo-600 text-white shadow-md ring-4 ring-indigo-500/20 scale-105 animate-glow-pulse"
                        : isComplete
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : isBlocked
                        ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 ring-2 ring-red-500/20"
                        : "bg-slate-100 text-slate-400 dark:bg-slate-800/60 dark:text-slate-600"
                    }`}
                    title={step.label + ": " + step.description}
                  >
                    {isComplete ? (
                      <CheckCircle size={20} weight="fill" />
                    ) : isBlocked ? (
                      <WarningCircle size={20} weight="fill" />
                    ) : isLocked ? (
                      <Lock size={16} />
                    ) : (
                      <Sparkle size={18} weight={isActive ? "fill" : "regular"} />
                    )}
                  </div>

                  {/* Label */}
                  <span
                    className={`mt-2 text-xs font-semibold tracking-wide ${
                      isActive
                        ? "text-indigo-600 dark:text-indigo-400 font-bold"
                        : isComplete
                        ? "text-[var(--ink-strong)]"
                        : "text-[var(--ink-muted)]"
                    }`}
                  >
                    {step.label}
                  </span>
                  
                  {/* Subtle status text for accessibility */}
                  <span className="sr-only">({step.status})</span>
                </div>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Next Step Focus Card */}
      <div className="bg-slate-50/50 dark:bg-[#1b1c20]/45 border border-[var(--border)] rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-3xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded">
              Current Target
            </span>
            {steps.find(s => s.key === currentStepKey)?.status === "blocked" && (
              <span className="text-3xs font-bold uppercase tracking-widest text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded">
                Needs Attention
              </span>
            )}
          </div>
          
          <h2 className="font-display text-lg text-[var(--ink-strong)] font-semibold leading-snug">
            {title}
          </h2>
          
          <p className="text-sm text-[var(--ink-muted)] leading-relaxed">
            {description}
          </p>

          {/* "Why This Matters" employability callout */}
          <div className="border-l-2 border-indigo-400 pl-3 mt-3">
            <p className="text-xs italic text-[var(--ink-muted)] leading-normal">
              <strong>Why this matters for your career:</strong> {whyItMatters}
            </p>
          </div>
        </div>

        <Link
          href={actionLink}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-full px-5 py-2.5 text-sm transition-all hover:translate-x-0.5 shadow-sm min-h-[48px] shrink-0 self-start md:self-auto"
        >
          <span>{actionLabel}</span>
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
