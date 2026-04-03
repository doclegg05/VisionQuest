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
  const [drafts, setDrafts] = useState<Record<string, { status: string; notes: string; resumeFileId: string }>>(() =>
    Object.fromEntries(
      opportunities.map((opportunity) => [
        opportunity.id,
        {
          status: opportunity.application?.status || "saved",
          notes: opportunity.application?.notes || "",
          resumeFileId: opportunity.application?.resumeFileId || "",
        },
      ])
    )
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function persistApplication(
    opportunityId: string,
    draft: { status: string; notes: string; resumeFileId: string },
    successMessage: string,
  ) {
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opportunityId,
        status: draft.status,
        notes: draft.notes,
        resumeFileId: draft.resumeFileId,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Could not save your application status.");
    }

    setMessage(successMessage);
    router.refresh();
  }

  async function saveApplication(opportunityId: string) {
    const draft = drafts[opportunityId];
    if (!draft) return;

    setSavingId(opportunityId);
    setMessage(null);

    try {
      await persistApplication(opportunityId, draft, "Application tracker updated.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save your application status.");
    } finally {
      setSavingId(null);
    }
  }

  async function attachCurrentResume(opportunityId: string) {
    const draft = drafts[opportunityId];
    if (!draft) return;

    setAttachingId(opportunityId);
    setMessage(null);

    try {
      const resumeResponse = await fetch("/api/resume/application-file", {
        method: "POST",
      });
      const resumePayload = await resumeResponse.json().catch(() => null);
      if (!resumeResponse.ok) {
        throw new Error(resumePayload?.error || "Could not generate your current resume PDF.");
      }

      const nextDraft = {
        ...draft,
        resumeFileId: resumePayload?.file?.id || "",
      };

      await persistApplication(
        opportunityId,
        nextDraft,
        draft.resumeFileId
          ? "Attached resume refreshed from your saved Portfolio resume."
          : "Current Portfolio resume attached to this application.",
      );

      setDrafts((current) => ({
        ...current,
        [opportunityId]: nextDraft,
      }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not attach your current resume.");
    } finally {
      setAttachingId(null);
    }
  }

  async function removeAttachedResume(opportunityId: string) {
    const draft = drafts[opportunityId];
    if (!draft) return;

    const nextDraft = { ...draft, resumeFileId: "" };
    setDrafts((current) => ({
      ...current,
      [opportunityId]: nextDraft,
    }));

    setSavingId(opportunityId);
    setMessage(null);

    try {
      await persistApplication(opportunityId, nextDraft, "Attached resume removed from this application.");
    } catch (err) {
      setDrafts((current) => ({
        ...current,
        [opportunityId]: draft,
      }));
      setMessage(err instanceof Error ? err.message : "Could not remove the attached resume.");
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
            const draft = drafts[opportunity.id] || { status: "saved", notes: "", resumeFileId: "" };
            return (
              <div id={`opportunity-${opportunity.id}`} key={opportunity.id} className="surface-section p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words font-display text-2xl text-[var(--ink-strong)]">{opportunity.title}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        opportunity.status === "open"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-[var(--surface-interactive)] text-[var(--ink-strong)]"
                      }`}>
                        {opportunity.status}
                      </span>
                    </div>
                    <p className="mt-2 break-words text-sm text-[var(--ink-muted)]">
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
                      className="shrink-0 rounded-full border border-[rgba(18,38,63,0.12)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-raised)]"
                    >
                      Open listing
                    </a>
                  ) : null}
                </div>

                {opportunity.description ? (
                  <p className="mt-4 break-words text-sm leading-7 text-[var(--ink-muted)]">{opportunity.description}</p>
                ) : null}

                <div className="mt-5 rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[rgba(255,255,255,0.55)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Resume</p>
                      <p className="mt-2 text-sm text-[var(--ink-strong)]">
                        {draft.resumeFileId
                          ? "This opportunity has a saved PDF generated from your Portfolio resume."
                          : "Attach the current saved resume from your Portfolio tab before you apply."}
                      </p>
                    </div>
                  <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void attachCurrentResume(opportunity.id)}
                        disabled={attachingId === opportunity.id || savingId === opportunity.id}
                        className="rounded-full border border-[rgba(18,38,63,0.12)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-raised)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {attachingId === opportunity.id
                          ? "Preparing resume..."
                          : draft.resumeFileId
                            ? "Refresh Attached Resume"
                            : "Attach Current Resume"}
                      </button>
                      {draft.resumeFileId ? (
                        <a
                          href={`/api/files/download?id=${draft.resumeFileId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full border border-[rgba(18,38,63,0.12)] px-4 py-2 text-sm font-semibold text-[var(--accent-strong)] hover:bg-[var(--surface-raised)]"
                        >
                          View Resume
                        </a>
                      ) : null}
                      {draft.resumeFileId ? (
                        <button
                          type="button"
                          onClick={() => void removeAttachedResume(opportunity.id)}
                          disabled={savingId === opportunity.id || attachingId === opportunity.id}
                          className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Remove Resume
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_auto]">
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
                    className="theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => void saveApplication(opportunity.id)}
                    disabled={savingId === opportunity.id || attachingId === opportunity.id}
                    className="primary-button px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2 xl:col-span-1 xl:self-start"
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
