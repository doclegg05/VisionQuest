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
                      : "bg-gray-200 text-gray-400"
                }`}
              >
                {isComplete ? "✓" : i + 1}
              </div>
              {i < totalSteps - 1 && (
                <div
                  className={`h-0.5 w-4 rounded-full transition-colors sm:w-6 ${
                    isComplete ? "bg-emerald-500" : "bg-gray-200"
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
