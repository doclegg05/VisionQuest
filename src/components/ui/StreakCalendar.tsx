"use client";

interface StreakCalendarProps {
  days: Record<string, number>;
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export default function StreakCalendar({ days }: StreakCalendarProps) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Build 28-day window ending today
  const cells: { date: string; count: number; isToday: boolean }[] = [];
  for (let offset = -27; offset <= 0; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().slice(0, 10);
    cells.push({
      date: dateStr,
      count: days[dateStr] || 0,
      isToday: dateStr === todayStr,
    });
  }

  // Pad front so first cell aligns to its actual weekday column
  // JS getDay: 0=Sun, we want 0=Mon → (getDay + 6) % 7
  const firstDate = new Date(today);
  firstDate.setDate(firstDate.getDate() - 27);
  const startCol = (firstDate.getDay() + 6) % 7;
  const padCells = Array.from({ length: startCol }, (_, i) => ({
    date: `pad-${i}`,
    count: -1,
    isToday: false,
  }));

  const allCells = [...padCells, ...cells];

  return (
    <div className="mt-3">
      <p className="mb-2 text-xs font-medium text-[var(--ink-muted)]">Last 4 weeks</p>
      <div className="grid grid-cols-7 gap-1">
        {DAY_LABELS.map((label, i) => (
          <div key={i} className="text-center text-[10px] text-[var(--ink-muted)]">
            {label}
          </div>
        ))}
        {allCells.map((cell) =>
          cell.count < 0 ? (
            <div key={cell.date} />
          ) : (
            <div
              key={cell.date}
              title={`${cell.date}: ${cell.count} activit${cell.count === 1 ? "y" : "ies"}`}
              className={`mx-auto h-5 w-5 rounded-md transition-colors ${
                cell.isToday
                  ? cell.count > 0
                    ? "bg-green-500 ring-2 ring-green-300"
                    : "bg-gray-200 ring-2 ring-[var(--accent-strong)]"
                  : cell.count >= 3
                    ? "bg-green-500"
                    : cell.count > 0
                      ? "bg-green-300"
                      : "bg-gray-100"
              }`}
            />
          )
        )}
      </div>
    </div>
  );
}
