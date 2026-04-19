"use client";

import { useState } from "react";

import { apiFetch } from "@/lib/api";

interface GrantGoalRow {
  id: string;
  metric: string;
  programType: string;
  targetValue: number;
  actualValue: number;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  status: "on_track" | "at_risk" | "behind" | "not_started";
}

interface GrantProgressPanelProps {
  goals: GrantGoalRow[];
  regionId: string;
  onChange: () => void;
}

const STATUS_STYLE: Record<GrantGoalRow["status"], string> = {
  on_track: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]",
  at_risk: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]",
  behind: "bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]",
  not_started: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
};

const STATUS_LABEL: Record<GrantGoalRow["status"], string> = {
  on_track: "On track",
  at_risk: "At risk",
  behind: "Behind",
  not_started: "Not started",
};

const METRIC_OPTIONS = ["enrollments", "certifications", "placements", "ged_earned", "custom"] as const;
const PROGRAM_OPTIONS = ["all", "spokes", "adult_ed", "ietp"] as const;

export default function GrantProgressPanel({ goals, regionId, onChange }: GrantProgressPanelProps) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="surface-section p-5">
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl text-[var(--ink-strong)]">Grant progress</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Targets vs actuals. Actuals are derived from underlying enrollments, certifications, and placements.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
        >
          {adding ? "Cancel" : "Add target"}
        </button>
      </header>

      {error && (
        <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]" role="alert">
          {error}
        </p>
      )}

      {adding && (
        <AddGoalForm
          regionId={regionId}
          onCancel={() => setAdding(false)}
          onError={(message) => setError(message)}
          onCreated={() => {
            setAdding(false);
            setError(null);
            onChange();
          }}
        />
      )}

      {goals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No grant targets for this period. Add one so the dashboard can track progress.
        </p>
      ) : (
        <ul className="space-y-2">
          {goals.map((goal) => {
            const ratio = goal.targetValue > 0 ? goal.actualValue / goal.targetValue : 0;
            const percent = Math.min(Math.round(ratio * 100), 200);
            return (
              <li
                key={goal.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold text-[var(--ink-strong)]">
                      {humanizeMetric(goal.metric)} · {goal.programType}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {goal.actualValue} / {goal.targetValue} ({percent}%) ·{" "}
                      {new Date(goal.periodStart).toLocaleDateString()} –{" "}
                      {new Date(goal.periodEnd).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ${STATUS_STYLE[goal.status]}`}
                  >
                    {STATUS_LABEL[goal.status]}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
                  <div
                    className="h-full bg-[var(--accent-green)] transition-all"
                    style={{ width: `${Math.min(percent, 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function humanizeMetric(key: string): string {
  switch (key) {
    case "enrollments":
      return "Enrollments";
    case "certifications":
      return "Certifications";
    case "placements":
      return "Placements";
    case "ged_earned":
      return "GED earned";
    case "custom":
      return "Custom";
    default:
      return key;
  }
}

interface AddGoalFormProps {
  regionId: string;
  onCancel: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}

function AddGoalForm({ regionId, onCancel, onCreated, onError }: AddGoalFormProps) {
  const [metric, setMetric] = useState<(typeof METRIC_OPTIONS)[number]>("enrollments");
  const [programType, setProgramType] = useState<(typeof PROGRAM_OPTIONS)[number]>("all");
  const [targetValue, setTargetValue] = useState("10");
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch("/api/coordinator/grant-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regionId,
          metric,
          programType,
          targetValue: Number(targetValue),
          periodStart: new Date(periodStart).toISOString(),
          periodEnd: new Date(periodEnd).toISOString(),
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to add target");
      }
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add target.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 space-y-3"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Metric</span>
          <select
            value={metric}
            onChange={(event) => setMetric(event.target.value as typeof metric)}
            className="field w-full px-3 py-2 text-sm"
          >
            {METRIC_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {humanizeMetric(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Program</span>
          <select
            value={programType}
            onChange={(event) => setProgramType(event.target.value as typeof programType)}
            className="field w-full px-3 py-2 text-sm"
          >
            {PROGRAM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Target</span>
          <input
            type="number"
            min={0}
            value={targetValue}
            onChange={(event) => setTargetValue(event.target.value)}
            className="field w-full px-3 py-2 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Period start</span>
            <input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              className="field w-full px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Period end</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              className="field w-full px-3 py-2 text-sm"
            />
          </label>
        </div>
        <label className="space-y-1 md:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Notes (optional)</span>
          <input
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="field w-full px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="primary-button px-4 py-1.5 text-xs disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add target"}
        </button>
      </div>
    </form>
  );
}
