/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockBuildPathwayPlacementReport = mock.fn() as any;

mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) =>
        handler(session, ...args),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: { __marker: "the-app-prisma-client" },
  },
});

mock.module("@/lib/pathway-outcomes", {
  namedExports: {
    buildPathwayPlacementReport: mockBuildPathwayPlacementReport,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("GET /api/teacher/reports/pathway-outcomes", () => {
  beforeEach(() => {
    mockBuildPathwayPlacementReport.mock.resetCalls();
    mockBuildPathwayPlacementReport.mock.mockImplementation(async () => ({
      generatedAt: "2026-09-05T00:00:00.000Z",
      totalVerifiedPlacements: 0,
      placementsWithPathway: 0,
      placementsWithoutPathway: 0,
      pathwayCoveragePct: 0,
      byCluster: [],
    }));
  });

  it("returns { success: true, data: <report> }", async () => {
    const res = await route.GET();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.totalVerifiedPlacements, 0);
  });

  it("passes the app's RLS-scoped prisma client through, not a bespoke one", async () => {
    await route.GET();
    assert.equal(mockBuildPathwayPlacementReport.mock.callCount(), 1);
    const [client] = mockBuildPathwayPlacementReport.mock.calls[0].arguments;
    assert.equal((client as any).__marker, "the-app-prisma-client");
  });

  // A "runs inside withTeacherAuth (a plain teacher session gets a response,
  // not a 403)" case previously lived here, but this file's `@/lib/api-error`
  // mock replaces withTeacherAuth with an unconditional pass-through (see the
  // mock.module block above) — it never calls getSession/isStaffRole, so a
  // 403 could never occur regardless of what this route does. That made the
  // assertion tautological, not a real refusal check (2026-09 second-pass
  // review). Dropped rather than "fixed" here: pinning the REAL refusal
  // behavior would mean un-mocking withTeacherAuth for one case in a file
  // that otherwise relies on the pass-through for every other test, which
  // duplicates api-error.ts's own concern rather than this route's. If
  // withTeacherAuth's real 403 path needs a regression test, it belongs
  // next to withTeacherAuth in src/lib/api-error.ts, not per-route.
});
