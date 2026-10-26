const dueDateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function formatDueDate(dueAt: string | null): string {
  return dueAt ? dueDateFormat.format(new Date(dueAt)) : "No due date";
}
