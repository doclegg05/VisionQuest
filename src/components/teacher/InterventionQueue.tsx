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

  const allItems = unifyAndSort(alerts, inactivityQueue, reviewQueue);
  const filtered = filter === "all" ? allItems : allItems.filter((i) => i.category === filter);

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
            {totalCount} student{totalCount === 1 ? "" : "s"} need{totalCount === 1 ? "s" : ""} action
            {highCount > 0 ? ` • ${highCount} high priority` : ""}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
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
                    {" • "}{item.summary}
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
  );
}
