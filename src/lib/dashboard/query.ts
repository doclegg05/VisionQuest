import type { QueryClient } from "@tanstack/react-query";
import type { TaskDto, TaskPage } from "./tasks";

export const dashboardKey = (sessionId: string) => ["dashboard", sessionId] as const;
export const taskKey = (sessionId: string) => [...dashboardKey(sessionId), "tasks"] as const;
/**
 * Refetch on focus and reconnect once data is 30 seconds old. The interval
 * below is per region (`regionPollMs`): polling was most of what an idle
 * dashboard cost the database (M2, 74 statements a minute at 30 seconds).
 */
export const freshness = { staleTime: 30_000, refetchOnWindowFocus: true, refetchOnReconnect: true, refetchIntervalInBackground: false, retry: 1 } as const;
/** The dashboard regions the client polls, each with the endpoint it reads. The idle measurement (M2) reads this. */
export const DASHBOARD_REGIONS = ["overview", "activity", "tasks", "support"] as const;
export type DashboardRegion = (typeof DASHBOARD_REGIONS)[number];
/**
 * How often each region polls while the tab is visible, in milliseconds.
 * Tasks and advising (alerts, the next appointment, the next step) every 2
 * minutes. The outcome summaries and task charts change only when a record
 * does, and every such change the student makes on this page refetches all
 * regions, so they poll every 10. Every region also refetches on focus,
 * reconnect, any dashboard mutation and any pushed notification.
 */
export const regionPollMs: Readonly<Record<DashboardRegion, number>> = {
  overview: 600_000, activity: 600_000, tasks: 120_000, support: 120_000,
};
/** The status line's wording for a poll interval. */
export function describePoll(intervalMs: number): string {
  const minutes = Math.round(intervalMs / 60_000);
  return `checks every ${minutes} minute${minutes === 1 ? "" : "s"} while visible`;
}
/**
 * Whether a pushed notification is newer than the data on screen. Both
 * times are the server's (`createdAt`, and the region's `fetchedAt`), so a
 * skewed browser clock cannot misfire it, and the list the provider loads on
 * mount, all older, does not trigger a refetch.
 */
export function isNewNotification(createdAt: string | undefined, since: string): boolean {
  if (createdAt === undefined) return false;
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && created > Date.parse(since);
}
export class DashboardFetchError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "DashboardFetchError"; }
}
export async function dashboardFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new DashboardFetchError(data.error || "Could not save or load your work. Try again.", response.status);
  return data;
}
export function optimisticTasks(client: QueryClient, key: readonly unknown[], updates: { id: string; patch: Partial<TaskDto> }[]) {
  const snapshots = client.getQueriesData<TaskPage>({ queryKey: key });
  for (const [queryKey, page] of snapshots) {
    if (!page) continue;
    // Preserve membership, ordering, totals and versions until the server confirms.
    client.setQueryData<TaskPage>(queryKey, { ...page, tasks: page.tasks.map((task) => {
      const update = updates.find((u) => u.id === task.id);
      return update ? { ...task, ...update.patch, updatedAt: task.updatedAt } : task;
    }) });
  }
  return () => { for (const [queryKey, page] of snapshots) client.setQueryData(queryKey, page); };
}

/** The task dialog shows its own conflict panel, so a "Refresh" toast would contradict it and invite losing the draft. */
export function shouldShowMutationNotice(error: Error, variables: { quietConflicts?: boolean }): boolean {
  const conflictOrGone = error instanceof DashboardFetchError && (error.status === 409 || error.status === 404);
  return !(variables.quietConflicts && conflictOrGone);
}
