"use client";

import Link from "next/link";
import type { LearningPathway as LearningPathwayData } from "@/lib/learning-pathway";

interface LearningPathwayProps {
  pathway: LearningPathwayData;
}

const STATUS_CONFIG = {
  complete: {
    circleCls:
      "bg-emerald-500 border-emerald-500 text-white",
    icon: (
      <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
    badgeCls: "bg-emerald-100 text-emerald-800",
    badgeLabel: "Complete",
    textCls: "text-[var(--ink-muted)] line-through",
    cardCls: "opacity-70",
  },
  in_progress: {
    circleCls:
      "border-[var(--accent-strong)] bg-[rgba(15,154,146,0.12)] text-[var(--accent-strong)]",
    icon: (
      <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-strong)]" />
    ),
    badgeCls: "bg-[rgba(15,154,146,0.12)] text-[var(--accent-strong)]",
    badgeLabel: "In Progress",
    textCls: "text-[var(--ink-strong)] font-semibold",
    cardCls: "",
  },
  not_started: {
    circleCls: "border-[rgba(18,38,63,0.2)] bg-[var(--surface-raised)] text-[var(--ink-muted)]",
    icon: <span className="h-2 w-2 rounded-full bg-[rgba(18,38,63,0.2)]" />,
    badgeCls: "bg-[var(--muted)] text-[var(--ink-muted)]",
    badgeLabel: "Not Started",
    textCls: "text-[var(--ink-strong)]",
    cardCls: "",
  },
  locked: {
    circleCls: "border-[rgba(18,38,63,0.15)] bg-[rgba(18,38,63,0.04)] text-[var(--ink-muted)]",
    icon: (
      <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    badgeCls: "bg-[rgba(18,38,63,0.06)] text-[var(--ink-muted)]",
    badgeLabel: "Locked",
    textCls: "text-[var(--ink-muted)]",
    cardCls: "opacity-60",
  },
} as const;

export function LearningPathway({ pathway }: LearningPathwayProps) {
  const { clusterName, steps, completedCount, totalCount, estimatedWeeksRemaining } = pathway;

  return (
    <div className="surface-section p-5">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
            Your Learning Roadmap
          </p>
          <h2 className="mt-1 font-display text-xl text-[var(--ink-strong)]">
            {clusterName}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--ink-muted)]">
            <span>
              <span className="font-semibold text-[var(--ink-strong)]">{completedCount}</span>
              {" of "}
              <span className="font-semibold text-[var(--ink-strong)]">{totalCount}</span>
              {" complete"}
            </span>
            {estimatedWeeksRemaining > 0 && (
              <span className="flex items-center gap-1">
                <span aria-hidden="true">&#183;</span>
                {`~${estimatedWeeksRemaining} week${estimatedWeeksRemaining === 1 ? "" : "s"} remaining`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <ol className="relative" aria-label="Learning pathway steps">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const config = STATUS_CONFIG[step.status];

          return (
            <li key={step.id} className="relative flex gap-4 pb-0">
              {/* Vertical connector line */}
              <div className="flex flex-col items-center">
                <div
                  className={[
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2",
                    config.circleCls,
                    step.isCurrent ? "shadow-[0_0_0_4px_rgba(15,154,146,0.15)]" : "",
                  ].join(" ")}
                  aria-label={`Step ${index + 1}: ${step.name} — ${config.badgeLabel}`}
                >
                  {config.icon}
                </div>
                {!isLast && (
                  <div
                    className="mt-1 w-0.5 flex-1 bg-[rgba(18,38,63,0.1)]"
                    style={{ minHeight: "2rem" }}
                    aria-hidden="true"
                  />
                )}
              </div>

              {/* Step card */}
              <div
                className={[
                  "mb-3 min-w-0 flex-1 rounded-[1rem] border border-[rgba(18,38,63,0.08)] bg-[var(--surface-raised)]/60 px-4 py-3",
                  config.cardCls,
                  step.isCurrent
                    ? "border-[rgba(15,154,146,0.2)] bg-[rgba(15,154,146,0.04)]"
                    : "",
                ].join(" ")}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={["text-sm", config.textCls].join(" ")}>
                      <span className="mr-1 text-xs text-[var(--ink-muted)]">
                        {index + 1}.
                      </span>
                      {step.name}
                      {step.isCurrent && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-[var(--accent-strong)] px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
                          You are here
                        </span>
                      )}
                    </p>
                    {step.status === "locked" && step.prerequisites.length > 0 && (
                      <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                        Requires:{" "}
                        {step.prerequisites.map((prereqId, i) => (
                          <span key={prereqId}>
                            {i > 0 && ", "}
                            <span className="font-medium">
                              {prereqId.replace(/-/g, " ")}
                            </span>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-[var(--ink-muted)]">
                      {step.estimatedHours} hrs
                    </span>
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-xs font-semibold",
                        config.badgeCls,
                      ].join(" ")}
                    >
                      {config.badgeLabel}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function LearningPathwayEmpty() {
  return (
    <div className="surface-section p-6 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
        Your Learning Roadmap
      </p>
      <p className="mt-3 text-sm text-[var(--ink-muted)]">
        Complete your career discovery with Sage to see your personalized learning pathway.
      </p>
      <Link
        href="/chat"
        prefetch={false}
        className="primary-button mt-4 inline-block px-5 py-2.5 text-sm"
      >
        Chat with Sage
      </Link>
    </div>
  );
}
