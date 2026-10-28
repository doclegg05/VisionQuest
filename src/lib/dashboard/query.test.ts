import assert from "node:assert/strict";
import { it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { DashboardFetchError, dashboardKey, freshness, optimisticTasks, shouldShowMutationNotice, taskKey } from "./query";
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
