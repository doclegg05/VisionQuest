"use client";

interface StreakBadgeProps {
  currentStreak: number;
  longestStreak: number;
}

export default function StreakBadge({ currentStreak, longestStreak }: StreakBadgeProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1.5">
        <span className="text-lg">🔥</span>
        <div>
          <p className="text-sm font-bold text-[var(--ink-strong)]">{currentStreak}</p>
          <p className="text-xs text-[var(--ink-muted)]">day streak</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-lg">⭐</span>
        <div>
          <p className="text-sm font-bold text-[var(--ink-strong)]">{longestStreak}</p>
          <p className="text-xs text-[var(--ink-muted)]">best streak</p>
        </div>
      </div>
    </div>
  );
}
