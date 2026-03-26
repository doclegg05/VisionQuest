"use client";

import { useState, useEffect } from "react";

interface XpToastProps {
  amount: number;
  label?: string;
  onDone?: () => void;
}

export default function XpToast({ amount, label, onDone }: XpToastProps) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 50);
    const t2 = setTimeout(() => setPhase("exit"), 2500);
    const t3 = setTimeout(() => onDone?.(), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      className={`fixed right-4 top-20 z-[60] transition-all duration-500 md:right-6 md:top-6 ${
        phase === "enter" ? "-translate-y-4 opacity-0" :
        phase === "exit" ? "-translate-y-2 opacity-0" :
        "translate-y-0 opacity-100"
      }`}
    >
      <div
        className="flex items-center gap-2 rounded-2xl border border-[rgba(249,115,22,0.2)] bg-[rgba(255,255,255,0.92)] px-4 py-3 shadow-[0_20px_50px_rgba(249,115,22,0.15)] backdrop-blur-lg"
        role="status"
        aria-live="polite"
      >
        <span className="text-lg">⚡</span>
        <div>
          <p className="text-sm font-bold text-[var(--accent-strong)]">+{amount} XP</p>
          {label && <p className="text-[10px] text-[var(--ink-muted)]">{label}</p>}
        </div>
      </div>
    </div>
  );
}
