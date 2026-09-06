import { notFound, redirect } from "next/navigation";

import { BenchmarkAreaCard } from "@/components/teacher/benchmarks/BenchmarkAreaCard";
import { formatMoment } from "@/components/teacher/benchmarks/labels";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { loadBenchmarkDashboard } from "@/lib/benchmarks/dashboard";

/**
 * /teacher/admin/benchmarks — the benchmark dashboard (design §5).
 *
 * Admin only. The `(teacher)` layout already turns students away, so the one
 * check that matters here is the admin flag: a teacher who types the URL gets
 * the not-found page, never the numbers. Same rule the admin API routes apply
 * through `withAdminAuth` (`session.role !== "admin"` is refused), written out
 * inline because a page cannot wrap a route handler.
 *
 * Everything on the page comes from files the nightly workflow commits, read
 * by a server-side loader that never throws. No database, no fetch, no client
 * JavaScript: this is a report, not an app.
 */
export const dynamic = "force-dynamic";

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
      <dt className="text-xs text-[var(--ink-muted)]">{label}</dt>
      <dd className="text-2xl font-semibold text-[var(--ink-strong)]">{value}</dd>
    </div>
  );
}

export default async function BenchmarksPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") notFound();

  const data = loadBenchmarkDashboard();
  const { summary } = data;
  const nothingHasRun = summary.suitesWithResults === 0;

  return (
    <div className="page-shell space-y-6">
      <PageIntro
        eyebrow="Admin tools"
        title="Benchmarks"
        description="How well VisionQuest works, and whether that is going up or down. Each number is measured the same way every night and compared to the last number we agreed on."
      />

      <section aria-labelledby="summary-heading" className="theme-card rounded-xl p-5">
        <h2 id="summary-heading" className="text-base font-semibold text-[var(--ink-strong)]">
          Where things stand
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          These counts cover the tests that block a merge when they fail.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Passing" value={summary.gatePassing} />
          <SummaryTile label="Slipping" value={summary.gateWatching} />
          <SummaryTile label="Below the floor" value={summary.gateFailing} />
          <SummaryTile label="Not run yet" value={summary.gateNotRun} />
        </dl>
        <p className="mt-4 text-sm text-[var(--ink-muted)]">
          Last run: {formatMoment(data.lastRanAt)}
          {data.lastCommit ? ` · code ${data.lastCommit}` : ""}
        </p>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {summary.suitesWithResults} of {summary.suitesTotal} tests have a result on file.
          {summary.otherFailing > 0
            ? ` ${summary.otherFailing} more are below the floor, but they only report — they do not block a merge.`
            : ""}
        </p>
      </section>

      {nothingHasRun && (
        <section className="theme-card rounded-xl p-5">
          <h2 className="text-base font-semibold text-[var(--ink-strong)]">
            No results yet
          </h2>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            The nightly job has not saved a result to this branch yet. The list below still shows
            every test and the floor it has to clear.
          </p>
        </section>
      )}

      {data.problems.length > 0 && (
        <section aria-labelledby="problems-heading" className="theme-card rounded-xl p-5">
          <h2 id="problems-heading" className="text-base font-semibold text-[var(--ink-strong)]">
            Files we could not read
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--ink-muted)]">
            {data.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      )}

      {data.areas.map((area) => (
        <BenchmarkAreaCard key={area.area} area={area} />
      ))}

      {data.areas.length === 0 && (
        <section className="theme-card rounded-xl p-5">
          <p className="text-sm text-[var(--ink-muted)]">
            No tests are set up yet. Add one in the benchmark config folder.
          </p>
        </section>
      )}
    </div>
  );
}
