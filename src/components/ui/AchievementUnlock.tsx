"use client";

import { useState, useEffect } from "react";

interface AchievementUnlockProps {
  label: string;
  desc: string;
  onDone?: () => void;
}

export default function AchievementUnlock({ label, desc, onDone }: AchievementUnlockProps) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 50);
    const t2 = setTimeout(() => setPhase("exit"), 3500);
    const t3 = setTimeout(() => onDone?.(), 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      className={`fixed right-4 top-20 z-[70] w-80 transition-all duration-500 md:right-6 md:top-6 ${
        phase === "enter" ? "-translate-y-4 opacity-0" :
        phase === "exit" ? "-translate-y-2 opacity-0" :
        "translate-y-0 opacity-100"
      }`}
    >
      <div
        className="flex items-center gap-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-yellow-50 px-5 py-4 shadow-[0_20px_50px_rgba(245,158,11,0.2)] backdrop-blur-lg"
        onClick={() => onDone?.()}
        role="status"
        aria-live="polite"
      >
        <span className="text-3xl">🏅</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600/70">Achievement Unlocked</p>
          <p className="mt-0.5 font-display text-lg text-[var(--ink-strong)]">{label}</p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{desc}</p>
        </div>
      </div>
    </div>
  );
}
