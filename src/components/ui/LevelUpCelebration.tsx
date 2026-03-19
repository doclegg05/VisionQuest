"use client";

import { useState, useEffect } from "react";

interface LevelUpCelebrationProps {
  newLevel: number;
  onDone?: () => void;
}

export default function LevelUpCelebration({ newLevel, onDone }: LevelUpCelebrationProps) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 50);
    const t2 = setTimeout(() => setPhase("exit"), 4000);
    const t3 = setTimeout(() => onDone?.(), 4500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      {/* Background burst */}
      <div
        className={`absolute inset-0 transition-opacity duration-700 ${
          phase === "enter" ? "opacity-0" : phase === "exit" ? "opacity-0" : "opacity-100"
        }`}
        style={{
          background: "radial-gradient(circle at center, rgba(249,115,22,0.15) 0%, rgba(15,154,146,0.08) 40%, rgba(0,0,0,0.3) 100%)",
        }}
        onClick={() => onDone?.()}
      />

      {/* Content */}
      <div
        className={`relative text-center transition-all duration-700 ${
          phase === "enter" ? "scale-50 opacity-0" :
          phase === "exit" ? "scale-110 opacity-0 translate-y-[-2rem]" :
          "scale-100 opacity-100"
        }`}
      >
        <div className="relative">
          {/* Glow ring */}
          <div className={`absolute inset-0 -m-8 rounded-full transition-all duration-1000 ${
            phase === "hold" ? "opacity-100 scale-100" : "opacity-0 scale-75"
          }`} style={{
            background: "radial-gradient(circle, rgba(249,115,22,0.3) 0%, transparent 70%)",
            filter: "blur(20px)",
          }} />

          <div className="relative rounded-[2.5rem] border border-white/30 bg-[rgba(255,255,255,0.9)] px-12 py-10 shadow-[0_40px_100px_rgba(249,115,22,0.25)] backdrop-blur-xl">
            <p className="text-5xl mb-4">🚀</p>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--accent-strong)]">Level Up!</p>
            <p className="mt-3 font-display text-5xl text-[var(--ink-strong)]">{newLevel}</p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              {newLevel === 2 && "Horizon Set — you're finding your direction"}
              {newLevel === 3 && "Strategist — you're building real plans"}
              {newLevel === 4 && "Executor — you're making it happen"}
              {newLevel === 5 && "Quest Complete — you've mastered the journey"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
