/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding stands in for several real signatures. */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

import { escapeCsvValue } from "@/lib/csv";

// Outside the [regionId] folder, which `node --test` would read as a glob.

const REGION_ID = "cregion0000000000000001";
const NAME = 'North, "Valley"\n=HYPERLINK("x")';

let route: typeof import("./[regionId]/route");

before(async () => {
  const session = { id: "cadmin0000000000000001", studentId: "a", displayName: "A", role: "admin" };
  mock.module("@/lib/coordinator-auth", {
    exports: {
      withCoordinatorAuth: (_permission: string, handler: (...args: any[]) => Promise<Response>) => (req: Request, ctx: unknown) =>
        handler(session, req, ctx),
    },
  });
  mock.module("@/lib/region", { exports: { coordinatorHasRegion: async () => true } });
  mock.module("@/lib/instructor-metrics", { exports: { listInstructorMetricsForRegion: async () => [] } });
  mock.module("@/lib/grant-metrics", {
    exports: {
      currentMonthBounds: () => ({ start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-11-30T00:00:00Z") }),
      getRegionRollup: async () => ({
        regionName: NAME,
        classCount: 1,
        headline: { activeStudents: 0, enrollmentsInPeriod: 0, certificationsInPeriod: 0, placementsInPeriod: 0, gedEarnedInPeriod: 0 },
        grantGoals: [],
      }),
    },
  });
  route = await import("./[regionId]/route");
});

describe("GET /api/coordinator/reports/monthly/[regionId]", () => {
  it("escapes the region name in the CSV header, so it cannot add a row or a formula", async () => {
    const res = await route.GET(new Request("http://localhost/x"), { params: Promise.resolve({ regionId: REGION_ID }) });
    const csv = await res.text();
    assert.ok(csv.includes(`# Region: ${escapeCsvValue(NAME)}\n`));
    assert.equal(csv.includes(`# Region: ${NAME}`), false);
  });
});
