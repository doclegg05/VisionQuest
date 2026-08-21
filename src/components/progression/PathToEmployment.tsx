"use client";

import Link from "next/link";
import { CheckCircle, Lock, Sparkle, WarningCircle, ArrowRight } from "@phosphor-icons/react";
import type { PathStep, PathStepKey } from "@/lib/progression/student-next-step";

export interface PathToEmploymentProps {
  currentStepKey: PathStepKey;
  title: string;
  description: string;
  whyItMatters: string;
  actionLabel: string;
  actionLink: string;
  steps: PathStep[];
  /**
   * "full" carries the whole journey — the step strip plus the do-this-next
   * card — and belongs on the dashboard alone. Every other student page takes
   * "compact": one line naming the same next step, so the page's own content
   * starts at the top of the viewport instead of a screen below it.
   */
  variant?: "full" | "compact";
}

/**
 * A step's state as a sentence a person can read and a screen reader can
 * announce. Replaces the `title` tooltip this strip used to lean on — which
 * touch users could never open and keyboard users could never reach — and the
 * raw `(locked)` / `(active)` enum values it used to read out.
 *
 * A blocked step says so even when it is the current one: "needs attention" is
 * the more urgent fact, and losing it to the current-step phrasing is what
 * would make a stalled journey sound like a healthy one. Exported for tests.
 */
export function stepStatusPhrase(step: PathStep, isCurrent: boolean): string {
  if (step.status === "blocked") return "Needs attention.";
  if (isCurrent) return "This is your next step.";

  switch (step.status) {
    case "complete":
      return "Done.";
    case "available":
      return "Ready to start.";
    case "active":
      return "This is your next step.";
    case "locked":
      return "Locked. Finish the earlier steps first.";
    default: {
      const exhaustive: never = step.status;
      return exhaustive;
    }
  }
}

export function PathToEmployment({
  currentStepKey,
  title,
  description,
  whyItMatters,
  actionLabel,
  actionLink,
  steps,
  variant = "full",
}: PathToEmploymentProps) {
  const currentIndex = steps.findIndex((step) => step.key === currentStepKey);
  const currentStep = currentIndex >= 0 ? steps[currentIndex] : undefined;
  const isBlockedNow = currentStep?.status === "blocked";
  const completedCount = steps.filter((step) => step.status === "complete").length;

  // Both variants lead with the student's place on the path. Built as one
  // string so it reaches the DOM as a single text node — a screen reader says
  // "Step 2 of 8" rather than three fragments to reassemble.
  const positionLabel =
    currentIndex >= 0 ? `Step ${currentIndex + 1} of ${steps.length}` : null;

  if (variant === "compact") {
    return (
      <Link
        href={actionLink}
        data-testid="current-target-cta"
        className="surface-section flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl border border-[var(--border)] px-4 py-3 shadow-sm transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)]"
      >
        <span className="min-w-0">
          {positionLabel && (
            <span className="block text-xs text-[var(--ink-muted)]">{positionLabel}</span>
          )}
          <span className="block truncate text-sm font-semibold text-[var(--ink-strong)]">
            {currentStep ? `Next: ${currentStep.label}` : "Next step"}
          </span>
          {isBlockedNow && (
            <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-[var(--badge-error-text)]">
              <WarningCircle size={14} weight="fill" aria-hidden="true" />
              Needs attention.
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center text-[var(--accent-strong)]">
          <span className="sr-only">{actionLabel}</span>
          <ArrowRight size={20} weight="bold" aria-hidden="true" />
        </span>
      </Link>
    );
  }

  return (
    <div className="surface-section mb-6 w-full rounded-2xl border border-[var(--border)] p-5 shadow-sm sm:p-6">
      {/* Phone: one step, named and counted. Eight circles at 375px wrapped
          into four rows of mostly-locked padlocks, which pushed the page's own
          content a full viewport down and told the student nothing. */}
      <div data-testid="journey-step-summary" className="mb-5 md:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--ink-strong)]">
            {positionLabel ?? "Your path"}
            {currentStep && (
              <span className="font-normal text-[var(--ink-muted)]">{`: ${currentStep.label}`}</span>
            )}
          </p>
          <p className="shrink-0 text-xs text-[var(--ink-muted)]">{`${completedCount} done`}</p>
        </div>
        <div
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuetext={`${completedCount} of ${steps.length} steps done`}
          className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"
        >
          <div
            className="h-full rounded-full bg-[var(--accent-green)] transition-[width] duration-500"
            style={{ width: `${steps.length > 0 ? (completedCount / steps.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Tablet and up: the full journey, where there is room for it. */}
      <ol
        data-testid="journey-steps"
        aria-label="Your path to employment"
        className="mb-6 hidden w-full items-start justify-between gap-x-2 md:flex"
      >
        {steps.map((step, idx) => {
          const isActive = step.key === currentStepKey;
          const isComplete = step.status === "complete";
          const isLocked = step.status === "locked";
          const isBlocked = step.status === "blocked";

          return (
            <li key={step.key} className="flex flex-1 items-center">
              <div className="relative flex w-full flex-col items-center text-center">
                {idx > 0 && (
                  <div
                    className={`absolute top-5 left-[-50%] right-[50%] -z-10 h-0.5 ${
                      isComplete ? "bg-[var(--accent-green)]" : "bg-[var(--border-strong)]"
                    }`}
                  />
                )}

                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ${
                    isActive
                      ? "animate-glow-pulse scale-105 bg-[var(--accent-strong)] text-white shadow-md"
                      : isComplete
                        ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
                        : isBlocked
                          ? "bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]"
                          : "bg-[var(--surface-muted)] text-[var(--ink-faint)]"
                  }`}
                  aria-hidden="true"
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

                <span
                  className={`mt-2 text-xs font-semibold tracking-wide ${
                    isActive
                      ? "font-bold text-[var(--ink-strong)]"
                      : isComplete
                        ? "text-[var(--ink-strong)]"
                        : "text-[var(--ink-muted)]"
                  }`}
                >
                  {step.label}
                </span>

                {/* What the tooltip used to hide. */}
                <span className="sr-only">
                  {`${step.description}. ${stepStatusPhrase(step, isActive)}`}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* The next step itself. It sits on the card rather than in a second
          card inside it — one surface, one border, nothing nested. */}
      <div className="flex flex-col justify-between gap-5 border-t border-[var(--border)] pt-5 md:flex-row md:items-center">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[var(--badge-info-bg)] px-2 py-1 text-xs font-bold text-[var(--badge-info-text)]">
              Do this next
            </span>
            {isBlockedNow && (
              <span className="rounded-md bg-[var(--badge-error-bg)] px-2 py-1 text-xs font-bold text-[var(--badge-error-text)]">
                Needs attention
              </span>
            )}
          </div>

          <h2 className="font-display text-lg leading-snug font-semibold text-[var(--ink-strong)]">
            {title}
          </h2>

          <p className="text-sm leading-relaxed text-[var(--ink-muted)]">{description}</p>

          <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3">
            <p className="text-sm leading-normal text-[var(--ink-strong)]">
              <strong className="font-semibold">Why this matters for your career:</strong>{" "}
              {whyItMatters}
            </p>
          </div>
        </div>

        <Link
          href={actionLink}
          data-testid="current-target-cta"
          className="primary-button min-h-[48px] shrink-0 self-start px-5 py-2.5 text-sm md:self-auto"
        >
          <span>{actionLabel}</span>
          <ArrowRight size={16} weight="bold" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
