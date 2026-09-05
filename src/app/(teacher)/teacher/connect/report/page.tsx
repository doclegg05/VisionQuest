import { redirect } from "next/navigation";

import { ConnectReportFilters } from "@/components/teacher/connect/ConnectReportFilters";
import PageIntro from "@/components/ui/PageIntro";
import { isStaffRole } from "@/lib/api-error";
import { getSession } from "@/lib/auth";
import { listManagedClasses } from "@/lib/classroom";
import { fetchConnectFunnel } from "@/lib/connect/funnel";
import { FUNNEL_STAGE_ORDER, type FunnelResult } from "@/lib/connect/funnel-shared";
import { listEmployers } from "@/lib/connect/employers";
import { prisma } from "@/lib/db";
import { buildPathwayPlacementReport, type PathwayPlacementReport } from "@/lib/pathway-outcomes";
import { withRlsContext } from "@/lib/rls-context";

/**
 * /teacher/connect/report — the Connect funnel (Match & Connect Task 6.1).
 *
 * Server-rendered end to end except the filter bar: this page reads
 * `searchParams` directly and re-fetches on every navigation, so there is no
 * client-side fetch and no loading spinner to build. Plain-language headers
 * throughout — this page is outside the readability gate's globs (teacher
 * surface), but the design principles apply anyway.
 */
export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<(typeof FUNNEL_STAGE_ORDER)[number], string> = {
  proposed: "Proposed",
  student_approved: "Student said OK",
  sent: "Sent to employer",
  viewed: "Employer looked",
  interested: "Employer is interested",
  interview_scheduled: "Meeting set",
  offered: "Offer made",
  hired: "Hired",
  started: "Started work",
  retained_30: "Still working — 30 days",
  retained_60: "Still working — 60 days",
  retained_90: "Still working — 90 days",
};

function formatDays(value: number | null): string {
  if (value === null) return "Not enough data yet";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

interface ConnectReportPageProps {
  searchParams: Promise<{
    classId?: string | string[];
    employerId?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConnectReportPage({ searchParams }: ConnectReportPageProps) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!isStaffRole(session.role)) redirect("/dashboard");

  const params = await searchParams;
  const classId = firstValue(params.classId) || undefined;
  const employerId = firstValue(params.employerId) || undefined;
  const from = firstValue(params.from) || undefined;
  const to = firstValue(params.to) || undefined;

  const rlsContext = {
    userId: session.id,
    role: session.role === "admin" ? ("admin" as const) : ("teacher" as const),
    studentId: "",
  };

  const { funnel, pathwayOutcomes, classes, employers, error } = await withRlsContext(
    rlsContext,
    async () => {
      const [classRows, employerRows] = await Promise.all([
        listManagedClasses(session),
        listEmployers(),
      ]);

      try {
        const [funnelResult, pathwayResult] = await Promise.all([
          fetchConnectFunnel(session, { classId, employerId, from, to }),
          buildPathwayPlacementReport(prisma),
        ]);
        return {
          funnel: funnelResult,
          pathwayOutcomes: pathwayResult,
          classes: classRows.map((row) => ({ id: row.id, name: row.name })),
          employers: employerRows.map((row) => ({ id: row.id, name: row.name })),
          error: null as string | null,
        };
      } catch {
        // A class the instructor does not manage (typed into the URL by hand)
        // gets a plain message here instead of a 500 page — the API route
        // itself still 403s for any programmatic caller.
        return {
          funnel: null as FunnelResult | null,
          pathwayOutcomes: null as PathwayPlacementReport | null,
          classes: classRows.map((row) => ({ id: row.id, name: row.name })),
          employers: employerRows.map((row) => ({ id: row.id, name: row.name })),
          error: "You do not have access to that class.",
        };
      }
    },
  );

  return (
    <div className="page-shell space-y-6">
      <PageIntro
        eyebrow="Teacher tools"
        title="Connect report"
        description="Where connections stall, who is hiring, and how this compares to students applying on their own."
      />

      <ConnectReportFilters
        classes={classes}
        employers={employers}
        initial={{ classId, employerId, from, to }}
      />

      {error && (
        <p role="alert" className="theme-card rounded-xl p-4 text-sm text-[var(--ink-strong)]">
          {error}
        </p>
      )}

      {funnel && (
        <>
          <section aria-labelledby="funnel-heading" className="theme-card rounded-xl p-5">
            <h2 id="funnel-heading" className="text-base font-semibold text-[var(--ink-strong)]">
              The funnel
            </h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-[var(--ink-muted)]">
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Stage
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Connections
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.stages.map((stage) => (
                    <tr key={stage.status} className="border-t border-[var(--ink-muted)]/10">
                      <td className="py-2 pr-4 text-[var(--ink-strong)]">
                        {STAGE_LABELS[stage.status]}
                      </td>
                      <td className="py-2 text-[var(--ink-strong)]">{stage.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[var(--ink-muted)]">Employer said not now</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">{funnel.exits.not_now}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">Student took it back</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">{funnel.exits.withdrawn}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">Teacher closed it</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">{funnel.exits.closed}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="speed-heading" className="theme-card rounded-xl p-5">
            <h2 id="speed-heading" className="text-base font-semibold text-[var(--ink-strong)]">
              How fast things move
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--ink-muted)]">Middle time from sent to an answer</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">
                  {formatDays(funnel.medians.sendToResponseDays)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">Middle time from sent to hired</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">
                  {formatDays(funnel.medians.sendToHireDays)}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="subsidy-heading" className="theme-card rounded-xl p-5">
            <h2 id="subsidy-heading" className="text-base font-semibold text-[var(--ink-strong)]">
              Hiring incentives
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[var(--ink-muted)]">Packets with a note</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">{funnel.subsidy.attached}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">Packets with no note</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">
                  {funnel.subsidy.notAttached}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">Hired, with a note</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">
                  {funnel.subsidy.hiredWithSubsidy}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">Hired, no note</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">
                  {funnel.subsidy.hiredWithout}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="employer-heading" className="theme-card rounded-xl p-5">
            <h2 id="employer-heading" className="text-base font-semibold text-[var(--ink-strong)]">
              By employer
            </h2>
            {funnel.byEmployer.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">No connections in this period.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left text-[var(--ink-muted)]">
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Employer
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Connections
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        Hired
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.byEmployer.map((row) => (
                      <tr key={row.employerId} className="border-t border-[var(--ink-muted)]/10">
                        <td className="py-2 pr-4 text-[var(--ink-strong)]">{row.employerName}</td>
                        <td className="py-2 pr-4 text-[var(--ink-strong)]">{row.total}</td>
                        <td className="py-2 text-[var(--ink-strong)]">{row.hired}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="class-heading" className="theme-card rounded-xl p-5">
            <h2 id="class-heading" className="text-base font-semibold text-[var(--ink-strong)]">
              By class
            </h2>
            {funnel.byClass.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">No connections in this period.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left text-[var(--ink-muted)]">
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Class
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Connections
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        Hired
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.byClass.map((row) => (
                      <tr key={row.classId ?? "none"} className="border-t border-[var(--ink-muted)]/10">
                        <td className="py-2 pr-4 text-[var(--ink-strong)]">{row.className}</td>
                        <td className="py-2 pr-4 text-[var(--ink-strong)]">{row.total}</td>
                        <td className="py-2 text-[var(--ink-strong)]">{row.hired}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="comparison-heading" className="theme-card rounded-xl p-5">
            <h2 id="comparison-heading" className="text-base font-semibold text-[var(--ink-strong)]">
              Compared to applying on their own
            </h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Same students, same time period, applications with no Connect introduction behind them.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[var(--ink-muted)]">Applied on their own</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">
                  {funnel.comparison.selfDirectedApplications}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">...and a teacher confirmed they got hired</dt>
                <dd className="font-semibold text-[var(--ink-strong)]">
                  {funnel.comparison.selfDirectedAcceptedVerified}
                </dd>
              </div>
            </dl>
          </section>
        </>
      )}

      {pathwayOutcomes && (
        <section aria-labelledby="pathway-outcomes-heading" className="theme-card rounded-xl p-5">
          <h2
            id="pathway-outcomes-heading"
            className="text-base font-semibold text-[var(--ink-strong)]"
          >
            Pathway outcomes
          </h2>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Which suggested career pathway {pathwayOutcomes.totalVerifiedPlacements === 1 ? "a" : ""}{" "}
            verified placement{pathwayOutcomes.totalVerifiedPlacements === 1 ? "" : "s"} actually came
            from ({pathwayOutcomes.pathwayCoveragePct}% traced back to a pathway).
          </p>
          {pathwayOutcomes.byCluster.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              No application yet carries a pathway.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-[var(--ink-muted)]">
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Cluster
                    </th>
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Placements
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Applications
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pathwayOutcomes.byCluster.map((row) => (
                    <tr key={row.clusterId} className="border-t border-[var(--ink-muted)]/10">
                      <td className="py-2 pr-4 text-[var(--ink-strong)]">{row.label}</td>
                      <td className="py-2 pr-4 text-[var(--ink-strong)]">{row.placements}</td>
                      <td className="py-2 text-[var(--ink-strong)]">
                        {row.applicationsWithThisPathway}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="export-heading" className="theme-card rounded-xl p-5">
        <h2 id="export-heading" className="text-base font-semibold text-[var(--ink-strong)]">
          DoHS export
        </h2>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">
          A CSV of enrollment, placement, and retention for the state report.
        </p>
        <a
          href={`/api/teacher/reports/connect/export.csv${classId ? `?classId=${classId}` : ""}`}
          className="mt-3 inline-block rounded-lg border px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          Download DoHS export (CSV)
        </a>
      </section>
    </div>
  );
}
