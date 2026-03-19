"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface OpportunityItem {
  id: string;
  title: string;
  company: string;
  type: string;
  location: string | null;
  url: string | null;
  description: string | null;
  status: string;
  deadline: string | null;
  application: {
    id: string;
    status: string;
    notes: string | null;
    resumeFileId: string | null;
    appliedAt: string | null;
    createdAt: string;
  } | null;
}

const APPLICATION_STATUSES = [
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "withdrawn", label: "Withdrawn" },
] as const;

export default function OpportunitiesHub({
  opportunities,
}: {
  opportunities: OpportunityItem[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, { status: string; notes: string }>>(() =>
    Object.fromEntries(
      opportunities.map((opportunity) => [
        opportunity.id,
        {
          status: opportunity.application?.status || "saved",
          notes: opportunity.application?.notes || "",
        },
      ])
    )
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function saveApplication(opportunityId: string) {
    const draft = drafts[opportunityId];
    if (!draft) return;

    setSavingId(opportunityId);
    setMessage(null);

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId,
          status: draft.status,
          notes: draft.notes,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not save your application status.");
      }

      setMessage("Application tracker updated.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save your application status.");
    } finally {
      setSavingId(null);
    }
  }

  const activeCount = opportunities.filter((opportunity) => opportunity.status === "open").length;
  const appliedCount = opportunities.filter((opportunity) => opportunity.application?.status === "applied").length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="surface-section p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Open now</p>
          <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">{activeCount}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Live roles, internships, and other opportunities.</p>
        </div>
        <div className="surface-section p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Applied</p>
          <p className="mt-2 text-3xl font-bold text-[var(--accent-secondary)]">{appliedCount}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Opportunities you&apos;ve already moved forward on.</p>
        </div>
        <div className="surface-section p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Tracking</p>
          <p className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">Keep your pipeline visible</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Save roles you&apos;re considering, then update them as you apply and interview.
          </p>
        </div>
      </div>

      {message ? (
        <div className="surface-section border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] p-4 text-sm text-[var(--ink-strong)]">
          {message}
        </div>
      ) : null}

      {opportunities.length === 0 ? (
        <div className="surface-section p-8 text-center text-[var(--ink-muted)]">
          No opportunities are posted yet.
        </div>
      ) : (
        <div className="space-y-4">
          {opportunities.map((opportunity) => {
            const draft = drafts[opportunity.id] || { status: "saved", notes: "" };
            return (
              <div key={opportunity.id} className="surface-section p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-2xl text-[var(--ink-strong)]">{opportunity.title}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        opportunity.status === "open"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}>
                        {opportunity.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      {opportunity.company} • {opportunity.type}
                      {opportunity.location ? ` • ${opportunity.location}` : ""}
                    </p>
                    {opportunity.deadline ? (
                      <p className="mt-1 text-sm text-[var(--accent-strong)]">
                        Deadline {new Date(opportunity.deadline).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                  {opportunity.url ? (
                    <a
                      href={opportunity.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-[rgba(18,38,63,0.12)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] hover:bg-white"
                    >
                      Open listing
                    </a>
                  ) : null}
                </div>

                {opportunity.description ? (
                  <p className="mt-4 text-sm leading-7 text-[var(--ink-muted)]">{opportunity.description}</p>
                ) : null}

                <div className="mt-5 grid gap-3 lg:grid-cols-[14rem_1fr_auto]">
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [opportunity.id]: {
                          ...draft,
                          status: event.target.value,
                        },
                      }))
                    }
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {APPLICATION_STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={draft.notes}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [opportunity.id]: {
                          ...draft,
                          notes: event.target.value,
                        },
                      }))
                    }
                    placeholder="Notes, follow-up steps, or interview details"
                    rows={3}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => void saveApplication(opportunity.id)}
                    disabled={savingId === opportunity.id}
                    className="primary-button px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingId === opportunity.id ? "Saving..." : "Update"}
                  </button>
                </div>

                {opportunity.application?.appliedAt ? (
                  <p className="mt-3 text-xs text-[var(--ink-muted)]">
                    Marked as applied {new Date(opportunity.application.appliedAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
