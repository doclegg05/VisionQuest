"use client";

interface ArcWeekDef {
  week: number;
  label: string;
  description: string;
}

const ARC_WEEKS: ArcWeekDef[] = [
  { week: 1, label: "Discovery", description: "Explore your interests and get oriented to the program." },
  { week: 2, label: "Dream Big", description: "Form your big goal and break it into monthly steps." },
  { week: 3, label: "Momentum", description: "Set weekly goals and start your first certification." },
  { week: 4, label: "Review", description: "Check progress, navigate obstacles, and adjust goals." },
  { week: 5, label: "Career Prep", description: "Build your resume, portfolio, and sharpen your skills." },
  { week: 6, label: "Launch Ready", description: "Finish certifications and prepare for your job search." },
];

interface CoachingArcBarProps {
  currentWeek: number;
  totalWeeks?: number;
}

export function CoachingArcBar({ currentWeek, totalWeeks = 6 }: CoachingArcBarProps) {
  const weeks = ARC_WEEKS.slice(0, totalWeeks);
  const current = weeks.find((w) => w.week === currentWeek) ?? weeks[0];

  return (
    <div className="surface-section p-5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
        Your 6-Week Journey
      </p>
      <p className="mt-1 font-semibold text-[var(--ink-strong)]">
        Week {currentWeek}: {current.label}
      </p>
      <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{current.description}</p>

      {/* Progress bar */}
      <div className="relative mt-4">
        {/* Connecting line */}
        <div className="absolute top-3.5 right-3.5 left-3.5 h-px bg-[rgba(18,38,63,0.12)]" aria-hidden />
        {/* Progress fill */}
        <div
          className="absolute top-3.5 left-3.5 h-px bg-[var(--accent-strong)] transition-all duration-500"
          style={{
            width:
              currentWeek <= 1
                ? "0%"
                : `${((currentWeek - 1) / (totalWeeks - 1)) * 100}%`,
          }}
          aria-hidden
        />

        {/* Week nodes */}
        <ol className="relative flex justify-between" aria-label="Coaching arc progress">
          {weeks.map((w) => {
            const isDone = w.week < currentWeek;
            const isCurrent = w.week === currentWeek;

            return (
              <li key={w.week} className="flex flex-col items-center gap-1.5">
                <span
                  aria-label={
                    isDone
                      ? `Week ${w.week} complete`
                      : isCurrent
                        ? `Week ${w.week} current`
                        : `Week ${w.week} upcoming`
                  }
                  className={[
                    "relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
                    isDone
                      ? "bg-[var(--accent-strong)] text-white"
                      : isCurrent
                        ? "animate-pulse bg-[var(--accent-strong)] text-white ring-4 ring-[rgba(15,154,146,0.20)]"
                        : "bg-[rgba(18,38,63,0.08)] text-[var(--ink-muted)]",
                  ].join(" ")}
                >
                  {isDone ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3.5 w-3.5"
                      aria-hidden
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    w.week
                  )}
                </span>
                <span
                  className={[
                    "text-[10px] font-medium leading-tight",
                    isCurrent
                      ? "text-[var(--accent-strong)]"
                      : "text-[var(--ink-muted)]",
                  ].join(" ")}
                >
                  {w.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
