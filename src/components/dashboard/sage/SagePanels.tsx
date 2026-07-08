import Link from "next/link";
import type { PanelCard } from "@/lib/sage/panel-spec";
import type { StudentPanel } from "@/lib/sage/panel-data";
import { SagePanelActions } from "./SagePanelActions";

/**
 * Server-rendered Sage-authored dashboard cards.
 *
 * Renders a Zod-validated PanelSpec through this fixed registry — Sage
 * chooses WHICH cards and their text; the components, markup, and styling
 * are ours. Plain-text interpolation only (React escapes it); no
 * dangerouslySetInnerHTML anywhere under components/dashboard/sage/.
 * Unknown card types are skipped, so an older client of a newer spec
 * degrades card-by-card instead of failing the page.
 */

function CardShell({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--accent-secondary)]">
        {eyebrow}
      </p>
      <div className="mt-1.5 text-sm text-[var(--ink-strong)]">{children}</div>
    </div>
  );
}

function FocusToday({ card }: { card: Extract<PanelCard, { type: "focus_today" }> }) {
  return (
    <CardShell eyebrow="Focus today">
      <p className="font-semibold">{card.title}</p>
      <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{card.body}</p>
    </CardShell>
  );
}

function ProgressHighlight({ card }: { card: Extract<PanelCard, { type: "progress_highlight" }> }) {
  return (
    <CardShell eyebrow="Worth celebrating">
      <p className="font-semibold">{card.title}</p>
      {card.metricValue && (
        <p className="mt-1">
          <span className="text-2xl font-bold">{card.metricValue}</span>
          {card.metricLabel && (
            <span className="ml-2 text-xs text-[var(--ink-muted)]">{card.metricLabel}</span>
          )}
        </p>
      )}
      <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{card.body}</p>
    </CardShell>
  );
}

function NextSteps({ card }: { card: Extract<PanelCard, { type: "next_steps" }> }) {
  return (
    <CardShell eyebrow="Next steps">
      <p className="font-semibold">{card.title}</p>
      <ul className="mt-1 space-y-1">
        {card.steps.map((step, i) => (
          <li key={i} className="text-sm">
            {step.href ? (
              <Link
                href={step.href}
                className="underline decoration-[var(--accent-secondary)] underline-offset-2 hover:text-[var(--accent-secondary)]"
              >
                {step.label}
              </Link>
            ) : (
              <>• {step.label}</>
            )}
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function Encouragement({ card }: { card: Extract<PanelCard, { type: "encouragement" }> }) {
  return (
    <CardShell eyebrow="From Sage">
      <p className="italic">{card.body}</p>
    </CardShell>
  );
}

function ResourcePointer({ card }: { card: Extract<PanelCard, { type: "resource_pointer" }> }) {
  return (
    <CardShell eyebrow="Worth a look">
      <Link
        href={card.href}
        className="font-semibold underline decoration-[var(--accent-secondary)] underline-offset-2 hover:text-[var(--accent-secondary)]"
      >
        {card.title}
      </Link>
      {card.body && <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{card.body}</p>}
    </CardShell>
  );
}

function renderCard(card: PanelCard, index: number): React.ReactNode {
  switch (card.type) {
    case "focus_today":
      return <FocusToday key={index} card={card} />;
    case "progress_highlight":
      return <ProgressHighlight key={index} card={card} />;
    case "next_steps":
      return <NextSteps key={index} card={card} />;
    case "encouragement":
      return <Encouragement key={index} card={card} />;
    case "resource_pointer":
      return <ResourcePointer key={index} card={card} />;
    default:
      return null; // unknown type from a newer spec version — skip, never crash
  }
}

export interface SagePanelsProps {
  panel: StudentPanel;
  /** Show dismiss/refresh controls (student's own dashboard). */
  showActions?: boolean;
}

export function SagePanels({ panel, showActions = false }: SagePanelsProps) {
  const generatedLabel = panel.generatedAt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <section
      aria-label="Sage's suggestions for today"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1"
    >
      {panel.spec.cards.map(renderCard)}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-[var(--ink-faint)]">Sage put this together · {generatedLabel}</p>
        {showActions && <SagePanelActions panelId={panel.id} />}
      </div>
    </section>
  );
}
