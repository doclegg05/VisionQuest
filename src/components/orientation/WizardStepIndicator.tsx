"use client";

interface WizardStepIndicatorProps {
  totalSteps: number;
  currentStep: number;  // 0-indexed
  currentTitle: string;
}

export default function WizardStepIndicator({
  totalSteps,
  currentStep,
  currentTitle,
}: WizardStepIndicatorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSteps }, (_, i) => {
          const isComplete = i < currentStep;
          const isCurrent = i === currentStep;
          return (
            <div key={i} className="flex items-center gap-1.5">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  isComplete
                    ? "bg-emerald-500 text-white"
                    : isCurrent
                      ? "bg-[var(--ink-strong)] text-white"
                      : "bg-[var(--surface-strong)] text-[var(--ink-faint)]"
                }`}
              >
                {isComplete ? "✓" : i + 1}
              </div>
              {i < totalSteps - 1 && (
                <div
                  className={`h-0.5 w-4 rounded-full transition-colors sm:w-6 ${
                    isComplete ? "bg-emerald-500" : "bg-[var(--surface-strong)]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-[var(--ink-muted)]">
        Document {currentStep + 1} of {totalSteps} — <span className="font-semibold text-[var(--ink-strong)]">{currentTitle}</span>
      </p>
    </div>
  );
}
