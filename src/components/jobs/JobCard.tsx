"use client";

import { useEffect, useState } from "react";
import { Briefcase, MapPin, CurrencyDollar, BookmarkSimple, ArrowSquareOut } from "@phosphor-icons/react";
import type { JobMatchReason, SavedJobStatus } from "@/lib/job-board/types";

export interface JobTrackingUpdate {
  status?: SavedJobStatus;
  notes?: string;
}

interface JobCardProps {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  matchScore: number;
  matchLabel: "Strong match" | "Good match" | null;
  clusters: string[];
  skillOverlap?: string[];
  matchReasons?: JobMatchReason[];
  savedStatus: SavedJobStatus | null;
  savedNotes?: string | null;
  savedAppliedAt?: string | null;
  url: string;
  compact?: boolean;
  onSave?: (jobId: string, updates?: JobTrackingUpdate) => void | Promise<void>;
}

const CLUSTER_COLORS: Record<string, string> = {
  "office-admin": "bg-blue-500/20 text-blue-300",
  "finance-bookkeeping": "bg-green-500/20 text-green-300",
  "tech-digital": "bg-purple-500/20 text-purple-300",
  "creative-design": "bg-pink-500/20 text-pink-300",
  "customer-service": "bg-orange-500/20 text-orange-300",
  "career-readiness": "bg-teal-500/20 text-teal-300",
  "language-esl": "bg-amber-500/20 text-amber-300",
};

const CLUSTER_LABELS: Record<string, string> = {
  "office-admin": "Office & Admin",
  "finance-bookkeeping": "Finance",
  "tech-digital": "Technology",
  "creative-design": "Creative",
  "customer-service": "Customer Service",
  "career-readiness": "Workforce Ready",
  "language-esl": "ESL",
};

const TRACKING_STATUSES: Array<{ value: SavedJobStatus; label: string }> = [
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
  { value: "offered", label: "Offered" },
  { value: "withdrawn", label: "Withdrawn" },
];

function formatStatusLabel(status: string): string {
  return TRACKING_STATUSES.find((option) => option.value === status)?.label ?? status;
}

export function JobCard({
  id,
  title,
  company,
  location,
  salary,
  matchLabel,
  clusters,
  matchReasons = [],
  savedStatus,
  savedNotes,
  savedAppliedAt,
  url,
  compact = false,
  onSave,
}: JobCardProps) {
  const primaryCluster = clusters[0];
  const visibleReasons = matchReasons.slice(0, 3);
  const [draftStatus, setDraftStatus] = useState<SavedJobStatus>(savedStatus ?? "saved");
  const [draftNotes, setDraftNotes] = useState(savedNotes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftStatus(savedStatus ?? "saved");
    setDraftNotes(savedNotes ?? "");
  }, [savedStatus, savedNotes]);

  async function persistTracking(update: JobTrackingUpdate) {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(id, update);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`surface-section rounded-xl border border-[var(--border)] ${compact ? "p-3" : "p-4"} relative`}>
      {/* Match label */}
      {matchLabel && (
        <span className={`absolute top-2 right-2 text-xs font-medium px-2 py-0.5 rounded-full ${
          matchLabel === "Strong match"
            ? "bg-green-500/20 text-green-300"
            : "bg-blue-500/20 text-blue-300"
        }`}>
          {matchLabel}
        </span>
      )}

      {/* Cluster badge */}
      {primaryCluster && (
        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-2 ${
          CLUSTER_COLORS[primaryCluster] ?? "bg-[var(--surface-interactive)] text-[var(--ink-faint)]"
        }`}>
          {CLUSTER_LABELS[primaryCluster] ?? primaryCluster}
        </span>
      )}

      {/* Job info */}
      <h3 className={["font-semibold text-[var(--text-primary)]", compact ? "text-sm" : "text-base", "leading-tight"].join(" ")}>
        {title}
      </h3>
      <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)] mt-1">
        <Briefcase size={14} />
        <span>{company}</span>
      </div>
      <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)] mt-0.5">
        <MapPin size={14} />
        <span>{location}</span>
      </div>

      {/* Salary */}
      {salary && (
        <div className="flex items-center gap-1 mt-2 text-[var(--accent)] font-semibold text-sm">
          <CurrencyDollar size={16} weight="bold" />
          <span>{salary}</span>
        </div>
      )}

      {!compact && visibleReasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {visibleReasons.map((reason) => (
            <span
              key={`${reason.type}:${reason.value ?? reason.label}`}
              className="rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
            >
              {reason.label}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      {!compact && (
        <div className="mt-3 space-y-3">
          {savedStatus ? (
            <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
              <select
                value={draftStatus}
                onChange={(event) => setDraftStatus(event.target.value as SavedJobStatus)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
              >
                {TRACKING_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
              <textarea
                value={draftNotes}
                onChange={(event) => setDraftNotes(event.target.value)}
                rows={2}
                maxLength={10000}
                placeholder="Notes, next step, or follow-up date"
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
              />
              <button
                type="button"
                onClick={() => void persistTracking({ status: draftStatus, notes: draftNotes })}
                disabled={saving}
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 sm:self-start"
              >
                {saving ? "Saving..." : "Update"}
              </button>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              onClick={() => void persistTracking({ status: "saved" })}
              disabled={saving}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                savedStatus
                  ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                  : "bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
              }`}
            >
              <BookmarkSimple size={14} weight={savedStatus ? "fill" : "regular"} />
              {savedStatus ? formatStatusLabel(savedStatus) : "Save"}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
            >
              <ArrowSquareOut size={14} />
              View
            </a>
            {savedAppliedAt ? (
              <span className="text-xs text-[var(--text-secondary)]">
                Applied {new Date(savedAppliedAt).toLocaleDateString()}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
