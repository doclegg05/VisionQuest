"use client";

import type { PlatformCategory } from "@/lib/spokes/platforms";
import { PLATFORM_CATEGORIES } from "@/lib/spokes/platforms";

interface PlatformFilterProps {
  categories: PlatformCategory[];
  selected: PlatformCategory | "all";
  onSelect: (cat: PlatformCategory | "all") => void;
  goalMatchCount: number;
  showGoalMatch: boolean;
  onToggleGoalMatch: () => void;
}

export default function PlatformFilter({
  categories,
  selected,
  onSelect,
  goalMatchCount,
  showGoalMatch,
  onToggleGoalMatch,
}: PlatformFilterProps) {
  const chipBase =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap";
  const chipActive =
    "bg-[var(--ink-strong)] text-white shadow-sm";
  const chipInactive =
    "border border-[var(--muted)]/30 text-[var(--muted)] hover:border-[var(--ink-strong)]/50 hover:text-[var(--ink-strong)]";
  const chipGoalActive =
    "bg-[var(--accent-strong)] text-white shadow-sm";

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
      {/* All chip */}
      <button
        onClick={() => onSelect("all")}
        className={`${chipBase} ${selected === "all" && !showGoalMatch ? chipActive : chipInactive}`}
      >
        All
      </button>

      {/* Category chips */}
      {categories.map((cat) => {
        const meta = PLATFORM_CATEGORIES[cat];
        return (
          <button
            key={cat}
            onClick={() => onSelect(cat)}
            className={`${chipBase} ${selected === cat && !showGoalMatch ? chipActive : chipInactive}`}
          >
            <span>{meta.icon}</span>
            {meta.label}
          </button>
        );
      })}

      {/* Goal match toggle */}
      {goalMatchCount > 0 && (
        <button
          onClick={onToggleGoalMatch}
          className={`${chipBase} ${showGoalMatch ? chipGoalActive : chipInactive}`}
        >
          My Goal Match ({goalMatchCount})
        </button>
      )}
    </div>
  );
}
