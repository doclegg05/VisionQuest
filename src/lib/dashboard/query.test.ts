import assert from "node:assert/strict";
import { it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { DashboardFetchError, dashboardKey, describePoll, freshness, isNewNotification, optimisticTasks, regionPollMs, shouldShowMutationNotice, taskKey } from "./query";
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
