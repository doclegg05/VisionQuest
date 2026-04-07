"use client";

import { useState, useEffect } from "react";

interface LevelUpCelebrationProps {
  newLevel: number;
  onDone?: () => void;
}

const LEVEL_LABELS: Record<number, string> = {
  2: "Horizon Set — you're finding your direction",
  3: "Strategist — you're building real plans",
  4: "Executor — you're making it happen",
  5: "Quest Complete — you've mastered the journey",
};

export default function LevelUpCelebration({ newLevel, onDone }: LevelUpCelebrationProps) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 50);
    const t2 = setTimeout(() => setPhase("exit"), 4500);
    const t3 = setTimeout(() => onDone?.(), 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      className={`fixed right-4 top-20 z-[80] w-80 transition-all duration-500 md:right-6 md:top-6 ${
        phase === "enter" ? "-translate-y-4 opacity-0" :
        phase === "exit" ? "-translate-y-2 opacity-0" :
        "translate-y-0 opacity-100"
      }`}
    >
      <div
        className="flex items-center gap-4 rounded-2xl border border-[var(--toast-celebration-border)] bg-[var(--toast-celebration-bg)] px-5 py-4 shadow-[0_20px_50px_rgba(211,178,87,0.15)]"
        onClick={() => onDone?.()}
        role="status"
        aria-live="polite"
      >
        <span className="text-3xl">🚀</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--toast-celebration-text)]">Level Up!</p>
          <p className="mt-0.5 font-display text-2xl text-[var(--ink-strong)]">Level {newLevel}</p>
          {LEVEL_LABELS[newLevel] && (
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{LEVEL_LABELS[newLevel]}</p>
          )}
        </div>
      </div>
    </div>
  );
}
