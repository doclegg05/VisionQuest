"use client";

interface RecentActivityProps {
  achievements: { key: string; label: string; desc: string }[];
  lastLevelUp: { level: number; at: string; reason: string } | null;
  currentStreak: number;
  xp: number;
}

export default function RecentActivity({ achievements, lastLevelUp, currentStreak, xp }: RecentActivityProps) {
  const recentItems = achievements.slice(0, 5);

  if (recentItems.length === 0 && !lastLevelUp) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-[var(--muted)]">Start earning achievements by talking to Sage, completing orientation, or exploring learning platforms!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {lastLevelUp && (
        <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 p-3">
          <span className="text-lg">🚀</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--ink-strong)]">Reached Level {lastLevelUp.level}</p>
            <p className="text-[10px] text-[var(--muted)]">{formatRelativeDate(lastLevelUp.at)}</p>
          </div>
        </div>
      )}
      {recentItems.map((a) => (
        <div key={a.key} className="flex items-center gap-3 rounded-xl bg-white/60 border border-[var(--border)] p-3">
          <span className="text-lg">🏅</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--ink-strong)]">{a.label}</p>
            <p className="text-[10px] text-[var(--muted)]">{a.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatRelativeDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
