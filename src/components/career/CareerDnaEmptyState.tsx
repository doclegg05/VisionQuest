import Link from "next/link";
import { ChatCircleDots, Compass } from "@phosphor-icons/react/dist/ssr";
import type { AssessmentCompleteness } from "@/lib/career-profile";

interface CareerDnaEmptyStateProps {
  /** Null when the student has not started the discovery conversation yet. */
  completeness: AssessmentCompleteness | null;
}

/**
 * First-class empty / in-progress state for /career/profile. Explains what
 * Career DNA is in plain language and routes the student back into the Sage
 * discovery conversation.
 */
export function CareerDnaEmptyState({ completeness }: CareerDnaEmptyStateProps) {
  const started = completeness !== null;

  return (
    <section aria-labelledby="career-dna-empty-heading" className="surface-section p-5 sm:p-6">
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent-green)] to-[var(--accent-blue)] text-white">
          <Compass size={24} weight="duotone" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id="career-dna-empty-heading"
            className="font-display text-xl font-bold text-[var(--ink-strong)]"
          >
            {started ? "Your Career DNA is still growing" : "Build your Career DNA with Sage"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Career DNA is a picture of what you like, what you are good at, and what matters to
            you in a job. Sage builds it with you in a short chat — no test, no wrong answers.
            When it is done, you will see career paths that fit you.
          </p>

          {started && (
            <div className="mt-4 max-w-md">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  Progress so far
                </span>
                <span className="font-bold text-[var(--ink-strong)]">
                  {completeness.completedSections} of {completeness.totalSections} parts
                </span>
              </div>
              <div aria-hidden="true" className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                <div
                  className="h-full rounded-full bg-[var(--accent-strong)]"
                  style={{ width: `${completeness.percent}%` }}
                />
              </div>
              {completeness.missingSections.length > 0 && (
                <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
                  Still to talk about: {completeness.missingSections.join(", ")}
                </p>
              )}
            </div>
          )}

          <Link
            href="/chat?stage=discovery"
            prefetch={false}
            className="primary-button mt-5 px-5 py-3 text-sm"
          >
            <ChatCircleDots size={18} weight="bold" aria-hidden="true" />
            {started ? "Continue with Sage" : "Start with Sage"}
          </Link>
        </div>
      </div>
    </section>
  );
}
