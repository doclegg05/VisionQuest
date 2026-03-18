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
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-500 ${
          phase === "enter" ? "opacity-0" : phase === "exit" ? "opacity-0" : "opacity-100"
        }`}
        onClick={() => onDone?.()}
      />

      {/* Card */}
      <div
        className={`relative rounded-[2rem] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 p-8 text-center shadow-[0_30px_80px_rgba(245,158,11,0.2)] transition-all duration-500 ${
          phase === "enter" ? "scale-75 opacity-0" :
          phase === "exit" ? "scale-95 opacity-0 -translate-y-4" :
          "scale-100 opacity-100"
        }`}
      >
        {/* Shimmer effect */}
        <div className="absolute inset-0 overflow-hidden rounded-[2rem]">
          <div className="absolute -inset-full animate-[shimmer_2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>

        <div className="relative">
          <p className="text-4xl mb-3">🏅</p>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600/70">Achievement Unlocked</p>
          <p className="mt-2 font-display text-2xl text-[var(--ink-strong)]">{label}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{desc}</p>
        </div>
      </div>
    </div>
  );
}
