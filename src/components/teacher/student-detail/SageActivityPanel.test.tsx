import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import {
  SageActivityList,
  SageActivityPanel,
  loadSageOperations,
  type SageOperationRow,
} from "./SageActivityPanel";

const sampleRow: SageOperationRow = {
  id: "op-1",
  toolName: "update_goal_status",
  targetSummary: "Updated a goal's status",
  status: "executed",
  statusLabel: "Completed",
  actorRole: "student",
  actorRoleLabel: "Student",
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-20T12:00:00.000Z",
};

describe("SageActivityList rendering", () => {
  it("shows a plain empty state when Sage has made no changes", () => {
    const html = renderToString(<SageActivityList operations={[]} />);

    assert.ok(html.includes("Sage has not made any changes for this student."));
  });

  it("renders the safe fields for a populated row", () => {
    const html = renderToString(<SageActivityList operations={[sampleRow]} />);

    assert.ok(html.includes("Updated a goal&#x27;s status"), html);
    assert.ok(html.includes("Completed"));
    assert.ok(html.includes("Student"));
  });

  it("never renders a payload or resultSummary field even if one sneaks onto the row", () => {
    const contaminated = {
      ...sampleRow,
      payload: { goalId: "goal-1", secretNote: "quoted chat content" },
      resultSummary: 'Mark the goal "quoted chat content" as completed?',
    } as SageOperationRow & { payload: unknown; resultSummary: string };

    const html = renderToString(<SageActivityList operations={[contaminated]} />);

    assert.ok(!html.includes("secretNote"));
    assert.ok(!html.includes("quoted chat content"));
  });

  it("renders one row per operation", () => {
    const rows: SageOperationRow[] = [
      sampleRow,
      { ...sampleRow, id: "op-2", toolName: "save_job", targetSummary: "Saved a job listing" },
    ];
    const html = renderToString(<SageActivityList operations={rows} />);

    assert.ok(html.includes("Updated a goal&#x27;s status"));
    assert.ok(html.includes("Saved a job listing"));
  });
});

describe("SageActivityPanel intro copy", () => {
  it("does not claim 'confirmed writes only' — proposed/rejected/failed rows can render too", () => {
    const html = renderToString(<SageActivityPanel studentId="stu-1" />);
    assert.ok(!html.includes("confirmed writes only"));
    assert.ok(html.includes("Actions Sage has taken or proposed for this student"));
    assert.ok(html.includes("never conversation content"));
  });
});

describe("loadSageOperations", () => {
  function fetchStub(impl: () => Promise<Response>) {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const stub = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return impl();
    };
    return Object.assign(stub as typeof fetch, { calls });
  }

  it("fetches the sage-operations route for the given student", async () => {
    const fetchFn = fetchStub(
      async () =>
        new Response(
          JSON.stringify({ success: true, data: { operations: [sampleRow], hasMore: false } }),
          { status: 200 },
        ),
    );

    const result = await loadSageOperations("stu-1", 1, fetchFn);

    assert.deepEqual(result, { ok: true, operations: [sampleRow], hasMore: false });
    assert.equal(fetchFn.calls[0].input, "/api/teacher/students/stu-1/sage-operations?page=1");
  });

  it("surfaces the route's error message", async () => {
    const fetchFn = fetchStub(
      async () => new Response(JSON.stringify({ error: "You do not have access to this student." }), { status: 403 }),
    );

    const result = await loadSageOperations("stu-1", 1, fetchFn);

    assert.deepEqual(result, { ok: false, error: "You do not have access to this student." });
  });

  it("returns a readable failure instead of throwing when the network drops", async () => {
    const fetchFn = fetchStub(async () => {
      throw new Error("network down");
    });

    const result = await loadSageOperations("stu-1", 1, fetchFn);

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.length > 0);
  });
});
