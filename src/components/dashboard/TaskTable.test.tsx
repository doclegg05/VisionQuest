import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import type { TaskDto, TaskPage } from "@/lib/dashboard/tasks";
import type { TaskQuery } from "@/lib/dashboard/task-schemas";

// Node does not process CSS modules; the browser harness verifies their real styles.
mock.module("./dashboard.module.css", { defaultExport: { dialog: "dialog" } });

const base = { studentId: "s1", status: "open", priority: "normal", dueAt: null, completedAt: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
const personal: TaskDto = { ...base, id: "t1", title: "Call the clinic", description: "", personal: true };
const staff: TaskDto = { ...base, id: "t2", title: "Submit pay stubs", description: "Bring two references", personal: false };
const data: TaskPage = { tasks: [personal, staff], total: 2, page: 1, pageSize: 10, fetchedAt: "2026-10-26T00:00:00.000Z" };
const query: TaskQuery = { search: "", status: "all", priority: "all", sort: "dueAt", direction: "asc", page: 1, pageSize: 10 };

let TaskTable: typeof import("./TaskTable").TaskTable;
before(async () => { ({ TaskTable } = await import("./TaskTable")); });

function render(): string {
  return renderToString(<TaskTable data={data} query={query} setQuery={() => {}} pending={false} save={async () => {}} remove={async () => {}} setStatus={() => {}} />);
}

describe("TaskTable row actions", () => {
  it("personal rows offer Edit and staff rows offer View details", () => {
    const html = render();
    assert.ok(html.includes(`Edit<span class="sr-only"> ${personal.title}`));
    assert.ok(html.includes(`View details<span class="sr-only"> ${staff.title}`));
    assert.ok(!html.includes("Staff-managed"));
  });

  it("no dialog markup renders inside the table", () => {
    const html = render();
    const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    assert.ok(table.length > 0);
    assert.ok(!table.includes('role="dialog"'));
  });
});
