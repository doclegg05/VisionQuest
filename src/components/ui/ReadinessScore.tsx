"use client";

import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";

interface ReadinessScoreProps {
  score: number;
  breakdown?: ReadinessBreakdown;
  size?: "sm" | "md";
}

export default function ReadinessScore({ score, breakdown, size = "md" }: ReadinessScoreProps) {
  const dims = size === "sm" ? { r: 32, stroke: 5, text: "text-lg", wrap: "h-20 w-20" } : { r: 52, stroke: 6, text: "text-3xl", wrap: "h-32 w-32" };
  const circumference = 2 * Math.PI * dims.r;
  const offset = circumference - (score / 100) * circumference;

  // Color based on score
  const color = score >= 75 ? "var(--accent-secondary)" : score >= 50 ? "#f59e0b" : "var(--accent-strong)";

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Circular progress */}
      <div className={`relative ${dims.wrap}`}>
        <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${(dims.r + dims.stroke) * 2} ${(dims.r + dims.stroke) * 2}`}>
          <circle
            cx={dims.r + dims.stroke}
            cy={dims.r + dims.stroke}
            r={dims.r}
            fill="none"
            stroke="var(--border)"
            strokeWidth={dims.stroke}
          />
          <circle
            cx={dims.r + dims.stroke}
            cy={dims.r + dims.stroke}
            r={dims.r}
            fill="none"
            stroke={color}
            strokeWidth={dims.stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-display font-bold text-[var(--ink-strong)] ${dims.text}`}>{score}%</span>
          {size === "md" && <span className="text-[9px] text-[var(--ink-muted)] uppercase tracking-wider">Ready</span>}
        </div>
      </div>

      {/* Breakdown bars */}
      {breakdown && size === "md" && (
        <div className="w-full space-y-1.5">
          {Object.values(breakdown).map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className="w-20 text-xs text-[var(--ink-muted)] text-right">{item.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-muted)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${item.max > 0 ? (item.score / item.max) * 100 : 0}%`,
                    backgroundColor: item.score === item.max ? "var(--accent-secondary)" : "var(--accent-strong)",
                  }}
                />
              </div>
              <span className="w-8 text-xs text-[var(--ink-muted)]">{item.score}/{item.max}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
