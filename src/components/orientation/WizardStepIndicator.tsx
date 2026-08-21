"use client";

interface WizardStepIndicatorProps {
  totalSteps: number;
  currentStep: number; // 0-indexed
  currentTitle: string;
}

export default function WizardStepIndicator({
  totalSteps,
  currentStep,
  currentTitle,
}: WizardStepIndicatorProps) {
  const percentComplete =
    totalSteps > 0 ? Math.min(100, ((currentStep + 1) / totalSteps) * 100) : 0;

  return (
    <div className="space-y-2">
      {/* One progressbar node for both renderings below: the dots and the bar are
          two views of the same value, and the aria attributes carry the meaning. */}
      <div
        role="progressbar"
        aria-valuenow={currentStep + 1}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-label={`Step ${currentStep + 1} of ${totalSteps}: ${currentTitle}`}
      >
        {/* Below md: a bar, not dots. The orientation packet runs to 16 documents,
            which wraps to roughly five rows of circles on a phone and pushes the
            document itself off screen. The line underneath already names the
            position ("Document 3 of 16 — ..."), so nothing is lost. */}
        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)] md:hidden">
          <div
            className="h-full rounded-full bg-[var(--accent-green)] transition-[width] duration-500"
            style={{ width: `${percentComplete}%` }}
          />
        </div>

        {/* md and up: the dot strip. It wraps rather than overflowing — at 16 steps
            the unwrapped row is wider than the card, so without this the last
            numbers run off the right edge. Wrapping keeps that true for any
            totalSteps instead of only the counts that happen to fit today. */}
        <div className="hidden flex-wrap items-center gap-x-1.5 gap-y-2 md:flex">
          {Array.from({ length: totalSteps }, (_, i) => {
            const isComplete = i < currentStep;
            const isCurrent = i === currentStep;
            return (
              <div key={i} className="flex items-center gap-x-1.5">
                <div
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    isComplete
                      ? "bg-emerald-500 text-white"
                      : isCurrent
                        ? "bg-[var(--accent-strong)] text-white"
                        : "bg-[var(--surface-strong)] text-[var(--ink-faint)]"
                  }`}
                >
                  {isComplete ? "✓" : i + 1}
                </div>
                {i < totalSteps - 1 && (
                  <div
                    className={`h-0.5 w-3 rounded-full transition-colors lg:w-4 ${
                      isComplete ? "bg-emerald-500" : "bg-[var(--surface-strong)]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-sm text-[var(--ink-muted)]">
        Document {currentStep + 1} of {totalSteps} —{" "}
        <span className="font-semibold text-[var(--ink-strong)]">{currentTitle}</span>
      </p>
    </div>
  );
}
