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

// Level config
const LEVEL_CONFIG: Record<string, { label: string; icon: string; color: string; indent: number }> = {
  bhag: { label: "Big Vision", icon: GOAL_LEVEL_META.bhag.icon, color: "from-amber-100 to-orange-50 border-amber-200", indent: 0 },
  monthly: { label: "Monthly Goal", icon: GOAL_LEVEL_META.monthly.icon, color: "from-sky-50 to-cyan-50 border-sky-200", indent: 1 },
  weekly: { label: "Weekly Goal", icon: "📋", color: "from-violet-50 to-purple-50 border-violet-200", indent: 2 },
  daily: { label: "Daily Goal", icon: "⚡", color: "from-emerald-50 to-green-50 border-emerald-200", indent: 3 },
  task: { label: "Action Task", icon: GOAL_LEVEL_META.task.icon, color: "from-[var(--surface-soft)] to-[var(--surface-soft)] border-[var(--border)]", indent: 4 },
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-100 text-emerald-700" },
  in_progress: { label: "In Progress", className: "bg-sky-100 text-sky-700" },
  blocked: { label: "Blocked", className: "bg-amber-100 text-amber-800" },
  completed: { label: "Done", className: "bg-violet-100 text-violet-700" },
  abandoned: { label: "Dropped", className: "bg-[var(--surface-interactive)] text-[var(--ink-muted)]" },
};

export default function GoalTree({ goals }: GoalTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (goals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[rgba(18,38,63,0.14)] p-6 text-center text-sm text-[var(--ink-muted)]">
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
    const config = LEVEL_CONFIG[goal.level] || { label: goal.level, icon: "📌", color: "from-[var(--surface-soft)] to-white border-[var(--border)]", indent: 0 };
    const status = STATUS_BADGE[goal.status] || {
      label: goalStatusLabel(goal.status),
      className: "bg-[var(--surface-interactive)] text-[var(--ink-strong)]",
    };
    const isCollapsed = collapsed.has(goal.id);
    const hasChildren = goal.children.length > 0;

    return (
      <div key={goal.id} style={{ marginLeft: `${depth * 1.5}rem` }}>
        <div className={`rounded-xl border bg-gradient-to-r ${config.color} p-3`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {hasChildren && (
                <button
                  onClick={() => toggleCollapse(goal.id)}
                  className="shrink-0 text-xs text-[var(--ink-muted)] hover:text-[var(--ink-strong)] transition-colors"
                >
                  <span className={`inline-block transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▶</span>
                </button>
              )}
              <span className="shrink-0">{config.icon}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)] shrink-0">{config.label}</span>
              <p className="text-sm text-[var(--ink-strong)]">{goal.content}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>
              {status.label}
            </span>
          </div>
        </div>

        {hasChildren && !isCollapsed && (
          <div className="ml-4 mt-1 space-y-1.5 border-l-2 border-[rgba(18,38,63,0.08)] pl-3">
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
