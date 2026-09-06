import type { DashboardArea, DashboardSuite } from "@/lib/benchmarks/dashboard";

import {
  STATE_LABEL,
  TIER_LABEL,
  TONE_CLASS,
  areaLabel,
  directionHint,
  floorText,
  formatChange,
  formatMoment,
  formatValue,
  metricLabel,
  metricStanding,
  MOVEMENT_LABEL,
} from "./labels";

/**
 * One card per area, one table per suite inside it.
 *
 * The table scrolls inside its own box (`overflow-x-auto`) so the page itself
 * never scrolls sideways on a phone. Every colour is paired with a word, so
 * the page still reads correctly in grayscale or to a screen reader.
 */

function Badge({ label, tone }: { label: string; tone: keyof typeof TONE_CLASS }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

function SuiteBlock({ suite }: { suite: DashboardSuite }) {
  const state = STATE_LABEL[suite.state];
  const headingId = `bench-${suite.suite}`;

  return (
    <article className="border-t border-[var(--border)] pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-base font-semibold text-[var(--ink-strong)]">
          {suite.title}
        </h3>
        <Badge label={state.label} tone={state.tone} />
        <Badge label={TIER_LABEL[suite.tier]} tone="quiet" />
      </div>

      <p className="mt-1 text-xs text-[var(--ink-muted)]">
        Last run: {formatMoment(suite.ranAt)}
        {suite.commit ? ` · code ${suite.commit}` : ""}
        {suite.model ? ` · model ${suite.model}` : ""}
      </p>

      {suite.note && (
        <p className="mt-2 text-sm text-[var(--ink-muted)]">Why it did not run: {suite.note}</p>
      )}

      {suite.problem && (
        <p role="alert" className="mt-2 text-sm text-[var(--badge-error-text)]">
          We could not read this file. {suite.problem}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm" aria-labelledby={headingId}>
          <thead>
            <tr className="text-left text-[var(--ink-muted)]">
              <th scope="col" className="py-1 pr-4 font-medium">
                What we measure
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                Now
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                Last agreed
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                Change
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                Floor
              </th>
              <th scope="col" className="py-1 font-medium">
                Standing
              </th>
            </tr>
          </thead>
          <tbody>
            {suite.metrics.map((metric) => {
              const standing = metricStanding(metric);
              const movement = MOVEMENT_LABEL[metric.movement];
              const change = formatChange(metric);
              return (
                <tr key={metric.id} className="border-t border-[var(--border)] align-top">
                  <th
                    scope="row"
                    className="max-w-[18rem] py-2 pr-4 text-left font-normal"
                  >
                    <span className="block font-medium text-[var(--ink-strong)]">
                      {metricLabel(metric.id)}
                    </span>
                    <span className="block text-xs text-[var(--ink-muted)]">
                      {metric.id}
                      {metric.n !== null ? ` · ${metric.n} checked` : ""}
                    </span>
                    {directionHint(metric) ? (
                      <span className="block text-xs text-[var(--ink-muted)]">
                        {directionHint(metric)}
                      </span>
                    ) : null}
                    {metric.reason ? (
                      <span className="mt-1 block whitespace-normal text-xs text-[var(--ink-muted)]">
                        Why there is no floor: {metric.reason}
                      </span>
                    ) : null}
                  </th>
                  <td className="py-2 pr-4 font-semibold text-[var(--ink-strong)]">
                    {formatValue(metric.value, metric.unit, metric.displayUnit)}
                  </td>
                  <td className="py-2 pr-4 text-[var(--ink-strong)]">
                    {formatValue(metric.baseline, metric.unit, metric.displayUnit)}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={movement.tone === "quiet" ? "text-[var(--ink-muted)]" : ""}>
                      {movement.label}
                    </span>
                    {change ? (
                      <span className="block text-xs text-[var(--ink-muted)]">by {change}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-[var(--ink-strong)]">{floorText(metric)}</td>
                  <td className="py-2">
                    <Badge label={standing.label} tone={standing.tone} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {suite.notes && (
        <details className="mt-3">
          <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-[var(--ink-strong)]">
            Notes from the team
          </summary>
          <p className="pb-2 text-sm text-[var(--ink-muted)]">{suite.notes}</p>
        </details>
      )}
    </article>
  );
}

export function BenchmarkAreaCard({ area }: { area: DashboardArea }) {
  return (
    <section aria-labelledby={`area-${area.area}`} className="theme-card rounded-xl p-5">
      <h2
        id={`area-${area.area}`}
        className="text-base font-semibold text-[var(--ink-strong)]"
      >
        {areaLabel(area.area)}
      </h2>
      <div className="mt-4 space-y-5">
        {area.suites.map((suite) => (
          <SuiteBlock key={suite.suite} suite={suite} />
        ))}
      </div>
    </section>
  );
}
