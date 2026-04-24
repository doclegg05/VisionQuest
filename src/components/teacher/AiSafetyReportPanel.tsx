"use client";

import { useState } from "react";

type ControlStatus = "pass" | "warn" | "info";

interface AiSafetyControl {
  label: string;
  status: ControlStatus;
  detail: string;
}

interface AiSafetyReport {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  reportText: string;
  reportHash: string;
  auditSummary: {
    totalAiEvents: number;
    sensitiveLocalRoutes: number;
    sensitiveCloudRoutes: number;
    directNoModelEvents: number;
    blockedEvents: number;
    failedEvents: number;
  };
  controls: AiSafetyControl[];
}

interface ApiErrorResponse {
  error?: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusClass(status: ControlStatus) {
  if (status === "pass") return "bg-emerald-100 text-emerald-700";
  if (status === "warn") return "bg-amber-100 text-amber-800";
  return "bg-sky-100 text-sky-800";
}

function statusLabel(status: ControlStatus) {
  if (status === "pass") return "Pass";
  if (status === "warn") return "Review";
  return "Info";
}

function downloadHtmlReport(report: AiSafetyReport) {
  const generatedDate = new Date(report.generatedAt);
  const filenameDate = generatedDate.toISOString().slice(0, 10);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VisionQuest AI Safety Audit Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #17211f; line-height: 1.55; margin: 40px; }
    h1 { font-size: 24px; margin-bottom: 6px; }
    .meta { color: #52615d; font-size: 13px; margin-bottom: 24px; }
    pre { white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 14px; }
    .hash { border-top: 1px solid #d8e1dd; margin-top: 24px; padding-top: 12px; font-size: 12px; color: #52615d; }
  </style>
</head>
<body>
  <h1>VisionQuest AI Student Information Protection Audit Report</h1>
  <div class="meta">Generated ${escapeHtml(generatedDate.toLocaleString())}</div>
  <pre>${escapeHtml(report.reportText)}</pre>
  <div class="hash">Report SHA-256: ${escapeHtml(report.reportHash)}</div>
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `visionquest-ai-safety-audit-${filenameDate}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function AiSafetyReportPanel() {
  const [report, setReport] = useState<AiSafetyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerate() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/ai-safety-report?days=30", {
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => null)) as
        | (ApiErrorResponse & AiSafetyReport)
        | null;

      if (!res.ok || !data) {
        setError(data?.error || "Could not generate the AI safety audit report.");
        return;
      }

      setReport(data);
      downloadHtmlReport(data);
    } catch {
      setError("Could not contact the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="surface-section p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-[var(--ink-muted)]">
              Generate a supervisor-ready report that documents the local-first AI routing policy,
              Gemini boundaries, public form bypass, and FERPA-safe audit counts. The report
              does not include prompts, responses, student names, or resumes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className="primary-button shrink-0 px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Generating..." : "Generate Audit Report"}
          </button>
        </div>
      </div>

      {report && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="surface-section p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Sensitive cloud routes
              </p>
              <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">
                {report.auditSummary.sensitiveCloudRoutes}
              </p>
            </div>
            <div className="surface-section p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Sensitive local routes
              </p>
              <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">
                {report.auditSummary.sensitiveLocalRoutes}
              </p>
            </div>
            <div className="surface-section p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                No-model form responses
              </p>
              <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">
                {report.auditSummary.directNoModelEvents}
              </p>
            </div>
          </div>

          <div className="surface-section p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--ink-strong)]">
                  Generated {new Date(report.generatedAt).toLocaleString()}
                </p>
                <p className="mt-1 break-all text-xs text-[var(--ink-muted)]">
                  Report SHA-256: {report.reportHash}
                </p>
              </div>
              <button
                type="button"
                onClick={() => downloadHtmlReport(report)}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
              >
                Download Again
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {report.controls.map((control) => (
                <span
                  key={control.label}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(control.status)}`}
                  title={control.detail}
                >
                  {statusLabel(control.status)}: {control.label}
                </span>
              ))}
            </div>

            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-6 text-[var(--ink-strong)]">
              {report.reportText}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
