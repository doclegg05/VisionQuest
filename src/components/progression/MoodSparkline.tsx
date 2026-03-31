"use client";

interface MoodEntry {
  id: string;
  score: number;
  context: string | null;
  extractedAt: string;
}

interface MoodSparklineProps {
  entries: MoodEntry[];
  showDateLabels?: boolean;
}

function scoreDotColor(score: number): string {
  if (score >= 7) return "#16a34a"; // green-600
  if (score >= 4) return "#d97706"; // amber-600
  return "#dc2626"; // red-600
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function formatDateFull(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function MoodSparkline({ entries, showDateLabels = false }: MoodSparklineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-muted)]">
        Not enough data yet — keep chatting with Sage!
      </p>
    );
  }

  const latestScore = entries[entries.length - 1].score;

  if (entries.length < 2) {
    return (
      <div className="flex items-center gap-3">
        <span
          className="text-3xl font-bold tabular-nums"
          style={{ color: scoreDotColor(latestScore) }}
        >
          {latestScore}
        </span>
        <p className="text-sm text-[var(--ink-muted)]">
          Not enough data yet — keep chatting with Sage!
        </p>
      </div>
    );
  }

  // SVG dimensions
  const svgWidth = 300;
  const svgHeight = showDateLabels ? 80 : 60;
  const paddingX = 12;
  const paddingY = 8;
  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = (showDateLabels ? 54 : 44) - paddingY * 2;

  const minScore = 1;
  const maxScore = 10;

  // Map entry index to x, score to y
  const points = entries.map((entry, i) => ({
    x: paddingX + (entries.length === 1 ? chartWidth / 2 : (i / (entries.length - 1)) * chartWidth),
    y: paddingY + chartHeight - ((entry.score - minScore) / (maxScore - minScore)) * chartHeight,
    entry,
  }));

  // Build polyline path
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // X-axis date labels (first and last)
  const firstLabel = formatDate(entries[0].extractedAt);
  const lastLabel = formatDate(entries[entries.length - 1].extractedAt);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-2 flex items-baseline gap-2">
        <span
          className="text-3xl font-bold tabular-nums leading-none"
          style={{ color: scoreDotColor(latestScore) }}
        >
          {latestScore}
        </span>
        <span className="text-xs text-[var(--ink-muted)]">/ 10 latest</span>
      </div>

      {/* Sparkline SVG */}
      <svg
        width="100%"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        aria-label="Motivation trend chart"
        role="img"
        className="w-full overflow-visible"
      >
        {/* Grid lines at 3, 5, 7 */}
        {[3, 5, 7].map((gridScore) => {
          const gy =
            paddingY +
            chartHeight -
            ((gridScore - minScore) / (maxScore - minScore)) * chartHeight;
          return (
            <line
              key={gridScore}
              x1={paddingX}
              y1={gy}
              x2={svgWidth - paddingX}
              y2={gy}
              stroke="rgba(18,38,63,0.07)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
          );
        })}

        {/* Trend line */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="rgba(18,38,63,0.18)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data point dots */}
        {points.map(({ x, y, entry }) => (
          <circle
            key={entry.id}
            cx={x}
            cy={y}
            r={4}
            fill={scoreDotColor(entry.score)}
            stroke="white"
            strokeWidth={1.5}
          >
            <title>
              {entry.score}/10
              {entry.context ? ` — ${entry.context}` : ""}
              {` (${formatDateFull(entry.extractedAt)})`}
            </title>
          </circle>
        ))}

        {/* Date labels */}
        {showDateLabels && (
          <>
            <text
              x={paddingX}
              y={svgHeight - 2}
              fontSize={9}
              fill="rgba(18,38,63,0.45)"
              textAnchor="start"
            >
              {firstLabel}
            </text>
            <text
              x={svgWidth - paddingX}
              y={svgHeight - 2}
              fontSize={9}
              fill="rgba(18,38,63,0.45)"
              textAnchor="end"
            >
              {lastLabel}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
