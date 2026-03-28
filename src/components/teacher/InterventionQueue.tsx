"use client";

import { useState } from "react";
import Link from "next/link";
import { getInactivityStageByType } from "@/lib/inactivity";
import {
  teacherDashboardAlertAction,
  teacherDashboardAlertQuickAction,
  teacherDashboardReviewAction,
  teacherDashboardReviewQuickAction,
} from "@/lib/intervention-notifications";
import { openSageWithMessage } from "@/components/chat/SageMiniChat";

interface AlertItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
}

interface InactivityItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  detectedAt: string;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
}

interface ReviewItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  detectedAt: string;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
  goalId?: string;
  goalContent?: string;
}

interface InterventionQueueProps {
  alerts: AlertItem[];
  inactivityQueue: InactivityItem[];
  reviewQueue: ReviewItem[];
  onAction: (intent: { type: string; studentId: string; alertId: string; studentName: string }) => void;
}

interface UnifiedItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  detectedAt: string;
  student: { id: string; studentId: string; displayName: string };
  category: "alert" | "inactivity" | "review";
  stageLabel?: string;
  nextStep?: string;
}

function unifyAndSort(
  alerts: AlertItem[],
  inactivity: InactivityItem[],
  review: ReviewItem[],
): UnifiedItem[] {
  const items: UnifiedItem[] = [];

  for (const a of alerts) {
    items.push({ ...a, category: "alert" });
  }

  for (const i of inactivity) {
    const stage = getInactivityStageByType(i.type);
    items.push({
      ...i,
      category: "inactivity",
      stageLabel: stage?.label || i.type,
      nextStep: stage?.nextStep || "",
    });
  }

  for (const r of review) {
    items.push({ ...r, category: "review" });
  }

  // Sort: high severity first, then by date (newest first)
  return items.sort((a, b) => {
    const sevOrder = a.severity === "high" ? 0 : 1;
    const sevOrderB = b.severity === "high" ? 0 : 1;
    if (sevOrder !== sevOrderB) return sevOrder - sevOrderB;
    return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
  });
}

// ─── Sage Summary ───────────────────────────────────────────────────────────

interface StudentSummary {
  student: { id: string; studentId: string; displayName: string };
  highCount: number;
  mediumCount: number;
  items: UnifiedItem[];
}

function groupByStudent(items: UnifiedItem[]): StudentSummary[] {
  const map = new Map<string, StudentSummary>();
  for (const item of items) {
    let entry = map.get(item.student.id);
    if (!entry) {
      entry = { student: item.student, highCount: 0, mediumCount: 0, items: [] };
      map.set(item.student.id, entry);
    }
    entry.items.push(item);
    if (item.severity === "high") entry.highCount++;
    else entry.mediumCount++;
  }
  // Sort by high-severity count desc, then total count desc
  return Array.from(map.values()).sort(
    (a, b) => b.highCount - a.highCount || b.items.length - a.items.length,
  );
}

function buildSageMessage(group: StudentSummary): string {
  const lines = [
    `I need help with interventions for ${group.student.displayName}. Here are their current alerts:\n`,
  ];
  for (const item of group.items) {
    lines.push(`- [${item.severity.toUpperCase()}] ${item.title}: ${item.summary}`);
  }
  lines.push(
    `\nPlease help me prioritize these, suggest what to address first, and recommend specific actions I can take for each one.`,
  );
  return lines.join("\n");
}

function SageSummaryPanel({ groups, totalCount }: { groups: StudentSummary[]; totalCount: number }) {
  const studentCount = groups.length;
  const highTotal = groups.reduce((sum, g) => sum + g.highCount, 0);

  function handleAskSageAll() {
    const lines = [`I have ${totalCount} interventions across ${studentCount} students. Here's a summary:\n`];
    for (const g of groups) {
      lines.push(`${g.student.displayName}: ${g.highCount} high, ${g.mediumCount} other (${g.items.length} total)`);
      for (const item of g.items.slice(0, 3)) {
        lines.push(`  - [${item.severity.toUpperCase()}] ${item.title}`);
      }
      if (g.items.length > 3) lines.push(`  - ...and ${g.items.length - 3} more`);
    }
    lines.push(`\nHelp me prioritize which students to address first and suggest an action plan for the most urgent issues.`);
    openSageWithMessage(lines.join("\n"));
  }

  return (
    <div className="rounded-[1.15rem] border border-[rgba(8,68,80,0.15)] bg-[linear-gradient(135deg,rgba(8,68,80,0.04),rgba(8,68,80,0.08))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-xl bg-[rgba(8,68,80,0.12)] text-sm font-bold text-[rgba(8,68,80,0.85)]">
              S
            </span>
            <p className="text-sm font-semibold text-[var(--ink-strong)]">Sage Summary</p>
          </div>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            {studentCount} student{studentCount !== 1 ? "s" : ""} need{studentCount === 1 ? "s" : ""} attention with {totalCount} total intervention{totalCount !== 1 ? "s" : ""}
            {highTotal > 0 ? `. ${highTotal} are high priority.` : "."}
          </p>
        </div>
        <button
          type="button"
          onClick={handleAskSageAll}
          className="rounded-full bg-[var(--ink-strong)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
        >
          Ask Sage to prioritize all
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {groups.map((group) => (
          <div
            key={group.student.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[0.85rem] bg-white/70 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/teacher/students/${group.student.id}`}
                className="text-sm font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
              >
                {group.student.displayName}
              </Link>
              <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                {group.items.length} issue{group.items.length !== 1 ? "s" : ""}
                {group.highCount > 0 ? ` (${group.highCount} high)` : ""}
                {" \u2014 "}
                {group.items.slice(0, 2).map((i) => i.title).join(", ")}
                {group.items.length > 2 ? `, +${group.items.length - 2} more` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openSageWithMessage(buildSageMessage(group))}
              className="shrink-0 rounded-full border border-[rgba(8,68,80,0.2)] px-3 py-1.5 text-xs font-semibold text-[rgba(8,68,80,0.85)] transition-colors hover:bg-[rgba(8,68,80,0.08)]"
            >
              Ask Sage
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Queue ─────────────────────────────────────────────────────────────

function getCategoryBadge(category: string) {
  switch (category) {
    case "inactivity":
      return { label: "Inactive", className: "bg-red-100 text-red-700" };
    case "review":
      return { label: "Review", className: "bg-blue-100 text-blue-700" };
    default:
      return { label: "Alert", className: "bg-amber-100 text-amber-700" };
  }
}

function getQuickAction(item: UnifiedItem): { label: string; href: string } | null {
  if (item.category === "review") {
    const qa = teacherDashboardReviewQuickAction(item.type);
    const action = teacherDashboardReviewAction(item.type, item.student.id);
    if (qa && action) return { label: qa.label, href: action.href };
  } else {
    const qa = teacherDashboardAlertQuickAction(item.type);
    const action = teacherDashboardAlertAction(item.type, item.student.id);
    if (qa && action) return { label: qa.label, href: action.href };
  }
  return null;
}

export default function InterventionQueue({ alerts, inactivityQueue, reviewQueue, onAction }: InterventionQueueProps) {
  const [filter, setFilter] = useState<"all" | "alert" | "inactivity" | "review">("all");
  const [showDetails, setShowDetails] = useState(false);

  const allItems = unifyAndSort(alerts, inactivityQueue, reviewQueue);
  const filtered = filter === "all" ? allItems : allItems.filter((i) => i.category === filter);
  const studentGroups = groupByStudent(allItems);

  const highCount = allItems.filter((i) => i.severity === "high").length;
  const totalCount = allItems.length;

  if (totalCount === 0) {
    return (
      <div className="surface-section p-5">
        <h2 className="font-display text-2xl text-[var(--ink-strong)]">Intervention Queue</h2>
        <p className="mt-3 rounded-[1rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
          No students need attention right now. Great work!
        </p>
      </div>
    );
  }

  return (
    <div className="surface-section p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
            Needs attention
          </p>
          <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Intervention Queue</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {totalCount} intervention{totalCount === 1 ? "" : "s"} across {studentGroups.length} student{studentGroups.length === 1 ? "" : "s"}
            {highCount > 0 ? ` \u2022 ${highCount} high priority` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)]"
        >
          {showDetails ? "Hide details" : "Show all details"}
        </button>
      </div>

      {/* Sage Summary — grouped by student */}
      <SageSummaryPanel groups={studentGroups} totalCount={totalCount} />

      {/* Detailed list — collapsed by default */}
      {showDetails && (
        <div className="mt-4">
          <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-0.5">
            {([
              { key: "all", label: `All (${totalCount})` },
              { key: "alert", label: "Alerts" },
              { key: "inactivity", label: "Inactive" },
              { key: "review", label: "Review" },
            ] as const).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filter === f.key
                    ? "bg-white text-[var(--ink-strong)] shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filtered.slice(0, 20).map((item) => {
              const badge = getCategoryBadge(item.category);
              const qa = getQuickAction(item);

              return (
                <div
                  key={item.id}
                  className={`rounded-[1rem] border p-4 transition-colors ${
                    item.severity === "high"
                      ? "border-red-200 bg-red-50/60"
                      : "border-amber-200 bg-amber-50/60"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                        {item.severity === "high" && (
                          <span className="rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                            High
                          </span>
                        )}
                        {item.stageLabel && (
                          <span className="text-[10px] font-semibold text-gray-500">{item.stageLabel}</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm font-semibold text-[var(--ink-strong)]">{item.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                        <Link href={`/teacher/students/${item.student.id}`} className="font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]">
                          {item.student.displayName}
                        </Link>
                        {" \u2022 "}{item.summary}
                      </p>
                      {item.nextStep && (
                        <p className="mt-1 text-xs text-gray-500">Next: {item.nextStep}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {qa && (
                        <Link
                          href={qa.href}
                          className="rounded-full border border-[rgba(18,38,63,0.12)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-gray-50"
                        >
                          {qa.label}
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => onAction({ type: item.type, studentId: item.student.id, alertId: item.id, studentName: item.student.displayName })}
                        className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)]"
                      >
                        Actions
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length > 20 && (
              <p className="py-2 text-center text-xs text-[var(--ink-muted)]">
                Showing 20 of {filtered.length} items
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
