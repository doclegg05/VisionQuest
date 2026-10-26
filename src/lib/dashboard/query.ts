import type { QueryClient } from "@tanstack/react-query";
import type { TaskDto, TaskPage } from "./tasks";

export const dashboardKey = (sessionId: string) => ["dashboard", sessionId] as const;
export const taskKey = (sessionId: string) => [...dashboardKey(sessionId), "tasks"] as const;
export const freshness = { staleTime: 30_000, refetchOnWindowFocus: true, refetchOnReconnect: true, refetchInterval: 30_000, refetchIntervalInBackground: false, retry: 1 } as const;
export async function dashboardFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save or load your work. Try again.");
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
