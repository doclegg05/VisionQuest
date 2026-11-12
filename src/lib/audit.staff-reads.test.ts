import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { classifyGetRoute, libReach, type LibReach } from "./staff-read-walk";

/**
 * Every staff GET that returns one student's record writes a view row
 * through `recordStudentView` (src/lib/audit.ts). Students are TANF/SNAP
 * recipients, and who looked at whose record is a compliance expectation.
 *
 * The walk reads every route under src/app/api. A GET is in scope when it
 * reaches a staff-on-student guard (`assertStaffCanManageStudent`,
 * `staffCanManageStudent`, `buildManagedStudentWhere`, or any exported
 * src/lib function that reaches one), reads a query parameter naming a
 * student, or sits under a `students/[id]` path; see `classifyGetRoute`
 * (src/lib/staff-read-walk.ts). Comments are stripped before matching. Each
 * in-scope GET must reach `recordStudentView` (itself or through a src/lib
 * helper) or appear in `EXEMPT` with a reason.
 *
 * Set STAFF_READ_WALK_ROOT and STAFF_READ_WALK_LIB_ROOT to walk other trees
 * (used to prove the walk fails on a scratch copy with a new unaudited route).
 */

const API_ROOT = process.env.STAFF_READ_WALK_ROOT ?? "src/app/api";
const LIB_ROOT = process.env.STAFF_READ_WALK_LIB_ROOT ?? "src/lib";

const CLASS_WIDE = "class-wide list or report over every managed student, not one student's record";

/**
 * In-scope GETs that record no view. Every entry needs a one-line reason.
 * Keys are paths under src/app/api, so a scratch copy (STAFF_READ_WALK_ROOT)
 * uses the same list.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "src/app/api/chat/warmup/route.ts":
    "reads only the caller's own record (session.id); the guard is reached through the AI provider's identity lookup",
  "src/app/api/teacher/certifications/route.ts": CLASS_WIDE,
  "src/app/api/teacher/classes/export-packets/route.ts":
    `${CLASS_WIDE}; writes its own teacher.class.packets_exported audit row`,
  "src/app/api/teacher/dashboard/route.ts": CLASS_WIDE,
  "src/app/api/teacher/export/route.ts": `${CLASS_WIDE}; writes its own teacher.export.csv audit row`,
  "src/app/api/teacher/failed-extractions/route.ts":
    `${CLASS_WIDE}; carries no chat text (the per-row GET records)`,
  "src/app/api/teacher/forms/[templateId]/export/route.ts":
    `${CLASS_WIDE}; writes its own teacher.form.export audit row`,
  "src/app/api/teacher/forms/responses/route.ts": CLASS_WIDE,
  "src/app/api/teacher/intervention-queue/route.ts": CLASS_WIDE,
  "src/app/api/teacher/reports/academic-kpi/route.ts": CLASS_WIDE,
  "src/app/api/teacher/reports/grant-kpi/route.ts": CLASS_WIDE,
  "src/app/api/teacher/reports/grant-kpi/students/route.ts": CLASS_WIDE,
  "src/app/api/teacher/reports/outcomes/route.ts": CLASS_WIDE,
  "src/app/api/teacher/reports/readiness-monthly/route.ts": CLASS_WIDE,
  "src/app/api/teacher/reports/spokes/route.ts": CLASS_WIDE,
};

/** The walk must keep finding at least this many routes, or its matching broke. */
const MIN_IN_SCOPE = 33;

/** Route files as `src/app/api/...` keys, plus where each one actually is. */
function routeFiles(): Array<{ key: string; file: string }> {
  return readdirSync(path.resolve(API_ROOT), { recursive: true, encoding: "utf8" })
    .filter((file) => path.basename(file) === "route.ts")
    .map((file) => ({ key: path.join("src/app/api", file), file: path.join(API_ROOT, file) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function libSources(): LibReach {
  const files = readdirSync(path.resolve(LIB_ROOT), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/u.test(file) && !/\.test\.tsx?$/u.test(file))
    .map((file) => path.join(LIB_ROOT, file));
  return libReach(files.map((file) => ({ file, source: readFileSync(file, "utf8") })));
}

function inScopeRoutes(): Map<string, { records: boolean; why: string[] }> {
  const lib = libSources();
  const routes = new Map<string, { records: boolean; why: string[] }>();
  for (const { key, file } of routeFiles()) {
    const result = classifyGetRoute(key, readFileSync(file, "utf8"), lib);
    if (result.kind === "in_scope") routes.set(key, { records: result.records, why: result.why });
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
