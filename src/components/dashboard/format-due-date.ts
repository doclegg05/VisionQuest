const DATE_ONLY_SUFFIX = "T12:00:00.000Z";
const dateOnlyFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function formatDueDate(dueAt: string | null, timeZone?: string): string {
  if (!dueAt) return "No due date";
  // Date-only values are stored at noon UTC so the calendar day never shifts.
  if (dueAt.endsWith(DATE_ONLY_SUFFIX)) return dateOnlyFormat.format(new Date(dueAt));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(dueAt));
}
