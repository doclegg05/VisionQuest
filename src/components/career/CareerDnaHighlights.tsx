import type { RiasecDimensionView } from "@/lib/career-profile";
import { isAssessedProfileSource } from "@/lib/career-provenance";

interface CareerDnaHighlightsProps {
  topInterests: RiasecDimensionView[];
  /** CareerDiscovery.profileSource — decides whether the blurb below credits
   *  a real assessment or names this as Sage's inference. Optional so
   *  existing callers that haven't threaded it through yet still render
   *  (falls back to the honest, conservative "Sage's guess" framing). */
  profileSource?: string;
}

/**
 * Plain-language summary of the student's strongest Holland interests.
 * Rendered above the detailed CareerProfile sections on /career/profile,
 * and on its own while an assessment is still in progress.
 */
export function CareerDnaHighlights({ topInterests, profileSource }: CareerDnaHighlightsProps) {
  if (topInterests.length === 0) return null;

  const assessed = profileSource !== undefined && isAssessedProfileSource(profileSource);

  return (
    <section aria-labelledby="career-dna-highlights-heading" className="surface-section p-5">
      <h2
        id="career-dna-highlights-heading"
        className="font-display text-xl font-bold text-[var(--ink-strong)]"
      >
        Your top interests
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
        {assessed
          ? "These are the kinds of work you enjoy most, from your CareerOneStop results."
          : "These are the kinds of work Sage thinks you enjoy most, based on your chats."}
      </p>
      <ol className="mt-4 grid list-none gap-3 sm:grid-cols-3">
        {topInterests.map((interest, idx) => (
          <li
            key={interest.key}
            className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--surface-raised)]/70 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-interactive)] text-xs font-bold text-[var(--primary)]"
              >
                {idx + 1}
              </span>
              <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-0.5 text-xs font-bold text-[var(--badge-success-text)]">
                {interest.percent}%
              </span>
            </div>
            <p className="mt-3 font-display text-lg font-bold text-[var(--ink-strong)]">
              {interest.nickname}
            </p>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
              {interest.label}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              {interest.plainLanguage}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
