"use client";

import { useEffect, useState } from "react";

interface ReportSummary {
  totalRecords: number;
  referred: number;
  enrolled: number;
  completed: number;
  exited: number;
  nonCompleters: number;
  orientationComplete: number;
  filesComplete: number;
  modulesComplete: number;
  familySurveyOffered: number;
  postSecondaryEntered: number;
  followUpsDue: number;
  followUpsCompleted: number;
}

interface QueueItem {
  id: string;
  studentId: string | null;
  studentName: string;
  status: string;
  orientationDone: number;
  orientationTotal: number;
  filesDone: number;
  filesTotal: number;
  modulesDone: number;
  modulesTotal: number;
  familySurveyOffered: boolean;
  employmentFollowUpsDue: number;
  reasons: string[];
}

interface ReportPayload {
  summary: ReportSummary;
  attentionQueue: QueueItem[];
}

const SUMMARY_KEYS: Array<{ key: keyof ReportSummary; label: string; tone: string }> = [
  { key: "totalRecords", label: "Records", tone: "text-[var(--ink-strong)]" },
  { key: "enrolled", label: "Enrolled", tone: "text-emerald-700" },
  { key: "orientationComplete", label: "Orientation complete", tone: "text-sky-700" },
  { key: "filesComplete", label: "Files complete", tone: "text-teal-700" },
  { key: "modulesComplete", label: "Modules complete", tone: "text-violet-700" },
  { key: "followUpsDue", label: "Follow-ups due", tone: "text-amber-800" },
];

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error
  ) {
    return payload.error;
  }

  return fallback;
}

export default function SpokesReport() {
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const response = await fetch("/api/teacher/reports/spokes");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not load the SPOKES report."));
      }

      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the SPOKES report.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading SPOKES report...</p>;
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error || "Could not load the SPOKES report."}</p>
        <button onClick={() => void loadData()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">SPOKES</p>
        <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Official program reporting snapshot</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SUMMARY_KEYS.map((card) => (
          <div key={card.key} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">{card.label}</p>
            <p className={`mt-2 text-3xl font-bold ${card.tone}`}>{data.summary[card.key]}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Program status mix</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-sm font-semibold text-slate-700">Referred</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{data.summary.referred}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-4">
              <p className="text-sm font-semibold text-emerald-700">Completed</p>
              <p className="mt-2 text-2xl font-bold text-emerald-900">{data.summary.completed}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4">
              <p className="text-sm font-semibold text-amber-800">Exited</p>
              <p className="mt-2 text-2xl font-bold text-amber-900">{data.summary.exited}</p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50/80 p-4">
              <p className="text-sm font-semibold text-rose-800">Non-completers</p>
              <p className="mt-2 text-2xl font-bold text-rose-900">{data.summary.nonCompleters}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-cyan-200 bg-cyan-50/80 p-4">
              <p className="text-sm font-semibold text-cyan-700">WV Family Survey offered</p>
              <p className="mt-2 text-2xl font-bold text-cyan-900">{data.summary.familySurveyOffered}</p>
            </div>
            <div className="rounded-lg border border-violet-200 bg-violet-50/80 p-4">
              <p className="text-sm font-semibold text-violet-700">Post-secondary entered</p>
              <p className="mt-2 text-2xl font-bold text-violet-900">{data.summary.postSecondaryEntered}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Attention queue</p>
              <h3 className="mt-2 text-lg font-semibold text-gray-900">Students needing follow-through</h3>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {data.attentionQueue.length} shown
            </span>
          </div>

          {data.attentionQueue.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No immediate SPOKES follow-through items right now.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {data.attentionQueue.map((item) => (
                <a
                  key={item.id}
                  href={item.studentId ? `/teacher/students/${item.studentId}/spokes` : "/teacher/manage"}
                  className="block rounded-lg border border-gray-100 p-4 transition-colors hover:border-[rgba(18,38,63,0.18)]"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{item.studentName}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                        {item.studentId || "Unlinked record"} • {item.status.replaceAll("_", " ")}
                      </p>
                    </div>
                    {item.employmentFollowUpsDue > 0 ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                        {item.employmentFollowUpsDue} follow-up due
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Orientation</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        {item.orientationDone}/{item.orientationTotal}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Files</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        {item.filesDone}/{item.filesTotal}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Modules</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        {item.modulesDone}/{item.modulesTotal}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full bg-[rgba(16,37,62,0.06)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-strong)]"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
