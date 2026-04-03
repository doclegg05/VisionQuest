"use client";

import { Briefcase, MapPin, CurrencyDollar, BookmarkSimple, ArrowSquareOut } from "@phosphor-icons/react";

interface JobCardProps {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  matchScore: number;
  matchLabel: "Strong match" | "Good match" | null;
  clusters: string[];
  savedStatus: string | null;
  url: string;
  compact?: boolean;
  onSave?: (jobId: string) => void;
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

export function JobCard({
  id,
  title,
  company,
  location,
  salary,
  matchLabel,
  clusters,
  savedStatus,
  url,
  compact = false,
  onSave,
}: JobCardProps) {
  const primaryCluster = clusters[0];

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
      <h3 className={`font-semibold text-[var(--text-primary)] ${compact ? "text-sm" : "text-base"} leading-tight`}>
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

      {/* Actions */}
      {!compact && (
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => onSave?.(id)}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors ${
              savedStatus
                ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                : "bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
            }`}
          >
            <BookmarkSimple size={14} weight={savedStatus ? "fill" : "regular"} />
            {savedStatus ? savedStatus.charAt(0).toUpperCase() + savedStatus.slice(1) : "Save"}
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
        </div>
      )}
    </div>
  );
}
