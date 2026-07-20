import { parseWellbeingCardSummary } from "@/lib/sage/wellbeing-card";

interface WellbeingCrisisCardProps {
  /** The wellbeing_concern StudentAlert summary (structured plain-text card). */
  summary: string;
  className?: string;
}

/**
 * Structured rendering for wellbeing_concern alert summaries: category chip,
 * detection time, recent mood when present, and the recommended-response
 * checklist. Teachers have no transcript access (locked privacy decision), so
 * this card is what makes the alert actionable. Falls back to the raw summary
 * text for legacy alerts that predate the structured format.
 */
export function WellbeingCrisisCard({ summary, className = "" }: WellbeingCrisisCardProps) {
  const card = parseWellbeingCardSummary(summary);

  if (!card) {
    return <p className={`text-sm text-[var(--ink-muted)] ${className}`}>{summary}</p>;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--urgency-critical-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--urgency-critical-text)]">
          {card.categoryLabel}
        </span>
        <span className="text-xs text-[var(--ink-faint)]">{card.detectedLabel}</span>
        {card.moodLabel ? (
          <span className="text-xs font-medium text-[var(--ink-muted)]">
            Mood {card.moodLabel}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-[var(--ink-muted)]">{card.lead}</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--ink-strong)]">
        {card.checklist.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </div>
  );
}
