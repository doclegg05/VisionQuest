import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { classifyGetRoute } from "./staff-read-walk";

/**
 * Every staff GET that returns one student's record writes a view row
 * through `recordStudentView` (src/lib/audit.ts). Students are TANF/SNAP
 * recipients, and who looked at whose record is a compliance expectation.
 *
 * The walk reads every route under src/app/api. A GET is in scope when it
 * reaches a staff-on-student guard (`assertStaffCanManageStudent`,
 * `staffCanManageStudent`), reads `?studentId=`, or sits under a
 * `students/[id]` path; see `classifyGetRoute` (src/lib/staff-read-walk.ts).
 * Comments are stripped before matching. Each in-scope GET must reach
 * `recordStudentView` or appear in `EXEMPT` with a reason.
 *
 * Set STAFF_READ_WALK_ROOT to walk another tree (used to prove the walk
 * fails on a scratch copy with a new unaudited route).
 */

const API_ROOT = process.env.STAFF_READ_WALK_ROOT ?? "src/app/api";

/** In-scope GETs that record no view. Every entry needs a one-line reason. */
const EXEMPT: Readonly<Record<string, string>> = {};

/** The walk must keep finding at least this many routes, or its matching broke. */
const MIN_IN_SCOPE = 18;

function routeFiles(): string[] {
  return readdirSync(path.resolve(API_ROOT), { recursive: true, encoding: "utf8" })
    .filter((file) => path.basename(file) === "route.ts")
    .map((file) => path.join(API_ROOT, file))
    .sort();
}

function inScopeRoutes(): Map<string, { records: boolean; why: string[] }> {
  const routes = new Map<string, { records: boolean; why: string[] }>();
  for (const file of routeFiles()) {
    const result = classifyGetRoute(file, readFileSync(file, "utf8"));
    if (result.kind === "in_scope") routes.set(file, { records: result.records, why: result.why });
  }
  return routes;
}

describe("staff reads of one student's record are audited", () => {
  const routes = inScopeRoutes();

  it("finds the routes it guards", () => {
    assert.ok(routes.size >= MIN_IN_SCOPE, `expected at least ${MIN_IN_SCOPE} in-scope GETs, found ${routes.size}`);
  });

  for (const [file, route] of routes) {
    it(`${file} GET records a view or is exempt with a reason`, () => {
      if (file in EXEMPT) return;
      assert.ok(route.records, `${file} GET (${route.why.join("; ")}) records no view`);
    });
  }

  it("every exemption has a reason and a route that needs it", () => {
    for (const [file, reason] of Object.entries(EXEMPT)) {
      assert.ok(reason.trim().length > 0, `${file} is exempt with no reason`);
      const route = routes.get(file);
      assert.ok(route !== undefined, `${file} is exempt but is not an in-scope GET route`);
      assert.equal(route.records, false, `${file} records a view, so its exemption is stale`);
    }
  });
});
