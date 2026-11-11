import assert from "node:assert/strict";
import { it } from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { DashboardFetchError, dashboardKey, describePoll, freshness, isNewNotification, optimisticTasks, refetchPlan, refetchWithoutOverlap, regionPollMs, retryOptions, shouldShowMutationNotice, taskKey } from "./query";
import type { TaskPage } from "./tasks";

it("optimistic status updates snapshot all affected task pages and roll back without touching another session", () => {
  const client = new QueryClient();
  const page: TaskPage = { tasks: [{ id: "one", studentId: "a", title: "Practice", description: null, personal: true, status: "open", priority: "normal", dueAt: null, completedAt: null, createdAt: "v1", updatedAt: "v1" }], total: 1, page: 1, pageSize: 10, fetchedAt: "now" };
  const a = [...taskKey("a"), { status: "open" }];
  const b = [...taskKey("b"), {}];
  client.setQueryData(a, page); client.setQueryData(b, page);
  const rollback = optimisticTasks(client, taskKey("a"), [{ id: "one", patch: { status: "completed", updatedAt: "invalid" } }]);
  assert.equal(client.getQueryData<TaskPage>(a)?.tasks[0].status, "completed");
  assert.equal(client.getQueryData<TaskPage>(a)?.tasks[0].updatedAt, "v1");
  assert.equal(client.getQueryData<TaskPage>(b)?.tasks[0].status, "open");
  rollback(); assert.deepEqual(client.getQueryData(a), page);
  client.clear();
});
it("keeps freshness bounded and private query scopes distinct", () => {
  assert.notDeepEqual(dashboardKey("one"), dashboardKey("two"));
  assert.equal(freshness.staleTime, 30000);
  assert.equal(freshness.refetchIntervalInBackground, false);
  assert.equal(freshness.refetchOnReconnect, true);
  assert.equal(freshness.refetchOnWindowFocus, true);
});

it("the dialog owns 409 and 404 messaging only when its edit save asked for quiet conflicts", () => {
  const conflict = new DashboardFetchError("A task has changed. Refresh before saving.", 409);
  const gone = new DashboardFetchError("Task not found.", 404);
  assert.equal(shouldShowMutationNotice(conflict, { quietConflicts: true }), false);
  assert.equal(shouldShowMutationNotice(gone, { quietConflicts: true }), false);
  assert.equal(shouldShowMutationNotice(conflict, {}), true);
  assert.equal(shouldShowMutationNotice(new DashboardFetchError("Server error", 500), { quietConflicts: true }), true);
  assert.equal(shouldShowMutationNotice(new Error("offline"), { quietConflicts: true }), true);
});

it("polls the live regions every 2 minutes and the record summaries every 10, refetching on focus and reconnect", () => {
  // M2: at 30 seconds an idle dashboard cost 74 statements a minute.
  assert.deepEqual(regionPollMs, { overview: 600_000, activity: 600_000, tasks: 120_000, support: 120_000 });
  assert.equal(freshness.refetchOnWindowFocus, true);
  assert.equal(freshness.refetchOnReconnect, true);
  assert.equal(describePoll(regionPollMs.support), "checks every 2 minutes while visible");
  assert.equal(describePoll(regionPollMs.overview), "checks every 10 minutes while visible");
});

it("treats a notification as new only when the server created it after the dashboard's data was read", () => {
  const since = "2026-11-10T15:00:00.000Z";
  assert.equal(isNewNotification("2026-11-10T15:00:01.000Z", since), true);
  assert.equal(isNewNotification("2026-11-10T14:59:59.000Z", since), false);
  assert.equal(isNewNotification(since, since), false);
  assert.equal(isNewNotification(undefined, since), false);
  assert.equal(isNewNotification("not a date", since), false);
});

// F2c item 4: one read in flight per region. React Query's default for
// invalidateQueries and refetch() cancels the running fetch and starts
// another; the browser abort does not stop the server's read, so the two
// overlap there. A trigger while a read is running waits for it, then reads once.
it("a region with a read in flight waits for it before reading again; an idle one reads at once", () => {
  assert.equal(refetchPlan("fetching"), "wait-then-read");
  assert.equal(refetchPlan("paused"), "read");
  assert.equal(refetchPlan("idle"), "read");
});

it("a retry joins a running read instead of cancelling it", () => {
  assert.deepEqual(retryOptions, { cancelRefetch: false });
});

it("a refetch during a running read never overlaps it and still reads once after the trigger", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let running = 0;
  let maxRunning = 0;
  let started = 0;
  let release: (() => void) | undefined;
  const queryFn = () => new Promise<number>((resolve) => {
    running += 1; started += 1; maxRunning = Math.max(maxRunning, running);
    const n = started;
    const done = () => { running -= 1; resolve(n); };
    if (n === 1) release = done; else setTimeout(done, 5);
  });
  const key = [...dashboardKey("s1"), "overview"];
  // Data already on screen, as the dashboard seeds it: only then does React
  // Query's default cancel the running read and start a second one.
  const observer = new QueryObserver(client, { queryKey: key, queryFn, initialData: 0, initialDataUpdatedAt: 0, staleTime: 30_000 });
  const unsubscribe = observer.subscribe(() => {});
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(started, 1, "the first read is running");
  const refetched = refetchWithoutOverlap(client, dashboardKey("s1"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(started, 1, "no second read while the first runs");
  release?.();
  await refetched;
  unsubscribe();
  assert.equal(maxRunning, 1);
  assert.equal(started, 2, "one fresh read after the trigger");
  assert.equal(client.getQueryData(key), 2);
});

it("a refetch while a region is disabled (a task save pending) still re-reads it once it is enabled again", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let started = 0;
  const queryFn = async () => { started += 1; return started; };
  const key = [...dashboardKey("s1"), "overview"];
  // Seeded and fresh, as the dashboard is right after an optimistic task save.
  const observer = new QueryObserver(client, { queryKey: key, queryFn, enabled: false, initialData: 0, initialDataUpdatedAt: Date.now(), staleTime: 30_000 });
  const unsubscribe = observer.subscribe(() => {});
  await refetchWithoutOverlap(client, dashboardKey("s1"));
  // isStale() counts only enabled observers in query-core v5, so read the flag the re-enable acts on.
  assert.equal(client.getQueryCache().find({ queryKey: key })?.state.isInvalidated, true, "the save marks the region invalidated");
  observer.setOptions({ queryKey: key, queryFn, enabled: true, staleTime: 30_000 });
  await new Promise((r) => setTimeout(r, 10));
  unsubscribe();
  assert.equal(started, 1, "re-enabling reads the region after the save");
  client.clear();
});
