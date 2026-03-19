"use client";

import { useState } from "react";

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
  bhag: { label: "Big Vision", icon: "🌟", color: "from-amber-100 to-orange-50 border-amber-200", indent: 0 },
  monthly: { label: "Monthly Goal", icon: "📅", color: "from-sky-50 to-cyan-50 border-sky-200", indent: 1 },
  weekly: { label: "Weekly Goal", icon: "📋", color: "from-violet-50 to-purple-50 border-violet-200", indent: 2 },
  daily: { label: "Daily Goal", icon: "⚡", color: "from-emerald-50 to-green-50 border-emerald-200", indent: 3 },
  task: { label: "Action Task", icon: "✅", color: "from-slate-50 to-gray-50 border-slate-200", indent: 4 },
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-100 text-emerald-700" },
  completed: { label: "Done", className: "bg-sky-100 text-sky-700" },
  abandoned: { label: "Dropped", className: "bg-gray-100 text-gray-500" },
};

export default function GoalTree({ goals }: GoalTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (goals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[rgba(18,38,63,0.14)] p-6 text-center text-sm text-[var(--ink-muted)]">
        <p className="text-2xl mb-2">🎯</p>
        <p>No goals set yet. Goals appear here after the student talks to Sage.</p>
      </div>
    );
  }

  // Build tree: group by level, then render in hierarchy order
  const byLevel: Record<string, GoalData[]> = {};
  for (const g of goals) {
    if (!byLevel[g.level]) byLevel[g.level] = [];
    byLevel[g.level].push(g);
  }

  const levelOrder = ["bhag", "monthly", "weekly", "daily", "task"];
  const toggleCollapse = (level: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  return (
    <div className="space-y-1">
      {levelOrder.map((level) => {
        const levelGoals = byLevel[level];
        if (!levelGoals || levelGoals.length === 0) return null;
        const config = LEVEL_CONFIG[level] || { label: level, icon: "📌", color: "from-gray-50 to-white border-gray-200", indent: 0 };
        const isCollapsed = collapsed.has(level);

        return (
          <div key={level} style={{ marginLeft: `${config.indent * 1.5}rem` }}>
            {/* Level header */}
            <button
              onClick={() => toggleCollapse(level)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-semibold text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.04)] transition-colors"
            >
              <span className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▶</span>
              <span>{config.icon}</span>
              <span className="uppercase tracking-wider">{config.label}</span>
              <span className="rounded-full bg-[rgba(18,38,63,0.08)] px-2 py-0.5 text-[10px]">{levelGoals.length}</span>
            </button>

            {/* Goal cards */}
            {!isCollapsed && (
              <div className="ml-4 mt-1 space-y-1.5 border-l-2 border-[rgba(18,38,63,0.08)] pl-3">
                {levelGoals.map((goal) => {
                  const status = STATUS_BADGE[goal.status] || STATUS_BADGE.active;
                  return (
                    <div
                      key={goal.id}
                      className={`rounded-xl border bg-gradient-to-r ${config.color} p-3`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-[var(--ink-strong)]">{goal.content}</p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
                          {status.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Connecting line indicator for hierarchy */}
            {!isCollapsed && config.indent < 4 && byLevel[levelOrder[levelOrder.indexOf(level) + 1]] && (
              <div className="ml-6 h-2 border-l-2 border-[rgba(18,38,63,0.08)]" />
            )}
          </div>
        );
      })}
    </div>
  );
}
