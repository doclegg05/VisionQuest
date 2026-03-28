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

// ─── Types ──────────────────────────────────────────────────────────────────

interface AlertItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
  student: { id: string; studentId: string; displayName: string };
}

interface InactivityItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  detectedAt: string;
  student: { id: string; studentId: string; displayName: string };
}

interface ReviewItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  detectedAt: string;
  student: { id: string; studentId: string; displayName: string };
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

// ─── Unify raw inputs ───────────────────────────────────────────────────────

function unifyItems(
  alerts: AlertItem[],
  inactivity: InactivityItem[],
  review: ReviewItem[],
): UnifiedItem[] {
  const items: UnifiedItem[] = [];
  for (const a of alerts) items.push({ ...a, category: "alert" });
  for (const i of inactivity) {
    const stage = getInactivityStageByType(i.type);
    items.push({ ...i, category: "inactivity", stageLabel: stage?.label || i.type, nextStep: stage?.nextStep || "" });
  }
  for (const r of review) items.push({ ...r, category: "review" });
  return items;
}

// ─── Consolidation ──────────────────────────────────────────────────────────
// Merges related alerts into single lines. E.g. 3 "orientation_form_missing"
// become one "3 orientation forms missing" with a single action link.

const CONSOLIDATION_GROUPS: Record<string, { label: string; groupCategory: string }> = {
  orientation_form_missing:        { label: "orientation forms missing",         groupCategory: "Orientation" },
  orientation_form_pending_review: { label: "forms awaiting review",             groupCategory: "Orientation" },
  orientation_form_revision_needed:{ label: "forms needing revision",            groupCategory: "Orientation" },
  orientation_item_incomplete:     { label: "orientation steps incomplete",      groupCategory: "Orientation" },
  orientation_not_started:         { label: "orientation not started",           groupCategory: "Orientation" },
  orientation_overdue:             { label: "orientation overdue",               groupCategory: "Orientation" },
  goal_needs_resource:             { label: "goals without assigned resources",  groupCategory: "Goals" },
  goal_resource_stale:             { label: "stale goal resources",              groupCategory: "Goals" },
  goal_platform_stale:             { label: "platforms visited, no follow-through", groupCategory: "Goals" },
  goal_review_pending:             { label: "goal evidence awaiting review",     groupCategory: "Goals" },
  goal_stale:                      { label: "stale goals",                       groupCategory: "Goals" },
  overdue_task:                    { label: "overdue tasks",                     groupCategory: "Tasks" },
  missed_appointment:              { label: "missed appointments",               groupCategory: "Advising" },
  certification_stalled:           { label: "certifications stalled",            groupCategory: "Certifications" },
};

interface ConsolidatedItem {
  key: string;
  groupCategory: string;
  label: string;
  count: number;
  severity: "high" | "medium";
  items: UnifiedItem[];
  primaryAction: { label: string; href: string } | null;
}

function consolidateItems(items: UnifiedItem[]): ConsolidatedItem[] {
  const buckets = new Map<string, ConsolidatedItem>();

  for (const item of items) {
    const group = CONSOLIDATION_GROUPS[item.type];
    const bucketKey = group ? item.type : `_ungrouped_${item.id}`;

    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      // Pick the primary action from the first item in the group
      let primaryAction: { label: string; href: string } | null = null;
      if (item.category === "review") {
        const qa = teacherDashboardReviewQuickAction(item.type);
        const action = teacherDashboardReviewAction(item.type, item.student.id);
        if (qa && action) primaryAction = { label: qa.label, href: action.href };
      } else {
        const qa = teacherDashboardAlertQuickAction(item.type);
        const action = teacherDashboardAlertAction(item.type, item.student.id);
        if (qa && action) primaryAction = { label: qa.label, href: action.href };
      }

      bucket = {
        key: bucketKey,
        groupCategory: group?.groupCategory || categoryLabel(item.category),
        label: group?.label || item.title,
        count: 0,
        severity: "medium",
        items: [],
        primaryAction,
      };
      buckets.set(bucketKey, bucket);
    }

    bucket.items.push(item);
    bucket.count++;
    if (item.severity === "high") bucket.severity = "high";
  }

  // Sort: high severity first, then by count desc
  return Array.from(buckets.values()).sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    return b.count - a.count;
  });
}

function categoryLabel(cat: string) {
  switch (cat) {
    case "inactivity": return "Inactivity";
    case "review": return "Review";
    default: return "Alert";
  }
}

// ─── Student grouping ───────────────────────────────────────────────────────

interface StudentGroup {
  student: { id: string; studentId: string; displayName: string };
  highCount: number;
  totalCount: number;
  items: UnifiedItem[];
  consolidated: ConsolidatedItem[];
  topCategory: string;
}

function groupByStudent(items: UnifiedItem[]): StudentGroup[] {
  const map = new Map<string, StudentGroup>();
  for (const item of items) {
    let entry = map.get(item.student.id);
    if (!entry) {
      entry = {
        student: item.student,
        highCount: 0,
        totalCount: 0,
        items: [],
        consolidated: [],
        topCategory: "",
      };
      map.set(item.student.id, entry);
    }
    entry.items.push(item);
    entry.totalCount++;
    if (item.severity === "high") entry.highCount++;
  }

  for (const entry of map.values()) {
    entry.consolidated = consolidateItems(entry.items);
    // The top category is the first consolidated item's group
    entry.topCategory = entry.consolidated[0]?.groupCategory || "";
  }

  return Array.from(map.values()).sort(
    (a, b) => b.highCount - a.highCount || b.totalCount - a.totalCount,
  );
}

// ─── Sage message builder ───────────────────────────────────────────────────

function buildSageMessage(group: StudentGroup): string {
  const lines = [
    `I need help with interventions for ${group.student.displayName}. Here are their current issues:\n`,
  ];
  for (const c of group.consolidated) {
    const sevTag = c.severity === "high" ? " [HIGH]" : "";
    lines.push(`- ${c.count > 1 ? `${c.count} ` : ""}${c.label}${sevTag}`);
  }
  lines.push(
    `\nPlease help me prioritize these, suggest what to address first, and recommend specific actions I can take.`,
  );
  return lines.join("\n");
}

function buildSageAllMessage(groups: StudentGroup[], totalCount: number): string {
  const lines = [`I have ${totalCount} interventions across ${groups.length} students. Here's a summary:\n`];
  for (const g of groups) {
    lines.push(`${g.student.displayName}: ${g.highCount} high priority, ${g.totalCount} total`);
    for (const c of g.consolidated.slice(0, 3)) {
      lines.push(`  - ${c.count > 1 ? `${c.count} ` : ""}${c.label}`);
    }
    if (g.consolidated.length > 3) lines.push(`  - ...and ${g.consolidated.length - 3} more categories`);
  }
  lines.push(`\nHelp me prioritize which students to address first and suggest an action plan for the most urgent issues.`);
  return lines.join("\n");
}

// ─── Student Accordion Row ──────────────────────────────────────────────────

function StudentAccordion({
  group,
  isOpen,
  onToggle,
  onAction,
}: {
  group: StudentGroup;
  isOpen: boolean;
  onToggle: () => void;
  onAction: InterventionQueueProps["onAction"];
}) {
  const borderColor = group.highCount > 0
    ? "border-red-200"
    : "border-amber-200";
  const bgColor = group.highCount > 0
    ? "bg-red-50/40"
    : "bg-amber-50/40";

  // Build a compact preview of consolidated categories
  const preview = group.consolidated
    .slice(0, 3)
    .map((c) => (c.count > 1 ? `${c.count} ${c.label}` : c.label))
    .join(", ");

  return (
    <div className={`overflow-hidden rounded-[1.15rem] border ${borderColor} ${bgColor} transition-colors`}>
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-black/[0.02]"
        aria-expanded={isOpen}
      >
        {/* Chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[var(--ink-muted)] transition-transform ${isOpen ? "rotate-90" : ""}`}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--ink-strong)]">
              {group.student.displayName}
            </span>
            {group.highCount > 0 && (
              <span className="rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                {group.highCount} urgent
              </span>
            )}
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
              {group.totalCount} item{group.totalCount !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">{preview}</p>
        </div>

        {/* Quick actions on the collapsed row */}
        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => openSageWithMessage(buildSageMessage(group))}
            className="rounded-full border border-[rgba(8,68,80,0.2)] px-3 py-1.5 text-xs font-semibold text-[rgba(8,68,80,0.85)] transition-colors hover:bg-[rgba(8,68,80,0.08)]"
          >
            Ask Sage
          </button>
          <Link
            href={`/teacher/students/${group.student.id}`}
            className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)]"
          >
            View student
          </Link>
        </div>
      </button>

      {/* Expanded — consolidated items grouped by category */}
      {isOpen && (
        <div className="border-t border-inherit px-4 pb-4 pt-3">
          {group.consolidated.map((c) => {
            const isHigh = c.severity === "high";
            return (
              <div
                key={c.key}
                className={`mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[0.85rem] border px-3 py-2.5 ${
                  isHigh ? "border-red-200 bg-red-50/80" : "border-gray-200 bg-white"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      {c.groupCategory}
                    </span>
                    {isHigh && (
                      <span className="rounded-full bg-red-200 px-1.5 py-0.5 text-[9px] font-bold text-red-800">
                        HIGH
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm font-medium text-[var(--ink-strong)]">
                    {c.count > 1 ? `${c.count} ${c.label}` : c.label}
                  </p>
                  {/* Show individual summaries if few enough */}
                  {c.count <= 3 && c.items.map((item) => (
                    <p key={item.id} className="mt-0.5 text-xs text-[var(--ink-muted)]">
                      {item.summary}
                    </p>
                  ))}
                  {c.count > 3 && (
                    <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                      {c.items[0].summary} and {c.count - 1} more
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.primaryAction && (
                    <Link
                      href={c.primaryAction.href}
                      className="rounded-full border border-[rgba(18,38,63,0.12)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-gray-50"
                    >
                      {c.primaryAction.label}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const first = c.items[0];
                      onAction({ type: first.type, studentId: first.student.id, alertId: first.id, studentName: first.student.displayName });
                    }}
                    className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)]"
                  >
                    Actions
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function InterventionQueue({ alerts, inactivityQueue, reviewQueue, onAction }: InterventionQueueProps) {
  const allItems = unifyItems(alerts, inactivityQueue, reviewQueue);
  const studentGroups = groupByStudent(allItems);
  const [openStudents, setOpenStudents] = useState<Set<string>>(new Set());

  const highCount = allItems.filter((i) => i.severity === "high").length;
  const totalCount = allItems.length;

  function toggleStudent(id: string) {
    setOpenStudents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setOpenStudents(new Set(studentGroups.map((g) => g.student.id)));
  }

  function collapseAll() {
    setOpenStudents(new Set());
  }

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
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
            Needs attention
          </p>
          <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Intervention Queue</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {totalCount} intervention{totalCount !== 1 ? "s" : ""} across {studentGroups.length} student{studentGroups.length !== 1 ? "s" : ""}
            {highCount > 0 ? ` \u2022 ${highCount} high priority` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openSageWithMessage(buildSageAllMessage(studentGroups, totalCount))}
            className="rounded-full bg-[var(--ink-strong)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
          >
            Ask Sage to prioritize
          </button>
          <button
            type="button"
            onClick={openStudents.size === studentGroups.length ? collapseAll : expandAll}
            className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)]"
          >
            {openStudents.size === studentGroups.length ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      {/* Student accordion list */}
      <div className="space-y-2">
        {studentGroups.map((group) => (
          <StudentAccordion
            key={group.student.id}
            group={group}
            isOpen={openStudents.has(group.student.id)}
            onToggle={() => toggleStudent(group.student.id)}
            onAction={onAction}
          />
        ))}
      </div>
    </div>
  );
}
