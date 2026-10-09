"use client";

import { useState } from "react";
import { GOAL_LEVEL_META, goalStatusLabel } from "@/lib/goals";

interface GoalData {
  id: string;
  level: string;
  content: string;
  status: string;
  parentId: string | null;
  createdAt: string;
}

interface GoalTreeProps {
  goals: GoalData[];
}

// Level config. Level is identity, not status: rows stay on a neutral surface
// and only the left rule carries the level color, so the status pill is the
// one place status color appears (and its badge pair sits on a plain surface).
const LEVEL_CONFIG: Record<string, { label: string; icon: string; color: string; indent: number }> = {
  bhag: { label: "Big Vision", icon: GOAL_LEVEL_META.bhag.icon, color: "border-l-[var(--accent-gold)]", indent: 0 },
  monthly: { label: "Monthly Goal", icon: GOAL_LEVEL_META.monthly.icon, color: "border-l-[var(--accent-blue)]", indent: 1 },
  weekly: { label: "Weekly Goal", icon: "📋", color: "border-l-[var(--border-strong)]", indent: 2 },
  daily: { label: "Daily Goal", icon: "⚡", color: "border-l-[var(--accent-green)]", indent: 3 },
  task: { label: "Action Task", icon: GOAL_LEVEL_META.task.icon, color: "border-l-[var(--border)]", indent: 4 },
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  proposed: { label: "Proposed", className: "bg-[var(--badge-info-bg)] text-[var(--badge-info-text)]" },
  active: { label: "Active", className: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" },
  in_progress: { label: "In Progress", className: "bg-[var(--badge-info-bg)] text-[var(--badge-info-text)]" },
  confirmed: { label: "Confirmed", className: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" },
  blocked: { label: "Blocked", className: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" },
  completed: { label: "Done", className: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" },
  abandoned: { label: "Dropped", className: "bg-[var(--surface-interactive)] text-[var(--ink-muted)]" },
};

export default function GoalTree({ goals }: GoalTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (goals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
        <p className="text-2xl mb-2">🎯</p>
        <p>No goals set yet. Goals appear here after the student talks to Sage or adds them manually.</p>
      </div>
    );
  }

  const goalMap = new Map<string, GoalData & { children: GoalData[] }>();
  for (const g of goals) {
    goalMap.set(g.id, { ...g, children: [] });
  }

  const roots: (GoalData & { children: GoalData[] })[] = [];
  const levelOrder = ["bhag", "monthly", "weekly", "daily", "task"];

  for (const g of Array.from(goalMap.values())) {
    if (g.parentId && goalMap.has(g.parentId)) {
      goalMap.get(g.parentId)!.children.push(g);
    } else {
      roots.push(g);
    }
  }

  roots.sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level));

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function renderGoalNode(goal: GoalData & { children: GoalData[] }, depth: number) {
    const config = LEVEL_CONFIG[goal.level] || { label: goal.level, icon: "📌", color: "border-l-[var(--border)]", indent: 0 };
    const status = STATUS_BADGE[goal.status] || {
      label: goalStatusLabel(goal.status),
      className: "bg-[var(--surface-interactive)] text-[var(--ink-strong)]",
    };
    const isCollapsed = collapsed.has(goal.id);
    const hasChildren = goal.children.length > 0;

    return (
      <div key={goal.id} style={{ marginLeft: `${depth * 1.5}rem` }}>
        <div className={`rounded-xl border border-l-4 border-[var(--border)] bg-[var(--surface-raised)] ${config.color} p-3`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {hasChildren && (
                <button
                  onClick={() => toggleCollapse(goal.id)}
                  aria-label="Steps under this goal"
                  aria-expanded={!isCollapsed}
                  className="inline-flex size-8 shrink-0 items-center justify-center pointer-coarse:size-11 text-xs text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)]"
                >
                  <span aria-hidden="true" className={`inline-block transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▶</span>
                </button>
              )}
              <span className="shrink-0">{config.icon}</span>
              <span className="text-xs font-semibold uppercase tracking-wider shrink-0 text-[var(--ink-muted)]">{config.label}</span>
              <p className="text-sm text-[var(--ink-strong)]">{goal.content}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>
              {status.label}
            </span>
          </div>
        </div>

        {hasChildren && !isCollapsed && (
          <div className="ml-4 mt-1 space-y-1.5 border-l-2 border-[var(--border)] pl-3">
            {goal.children
              .sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level))
              .map(child => renderGoalNode(child as GoalData & { children: GoalData[] }, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {roots.map(root => renderGoalNode(root, 0))}
    </div>
  );
}
