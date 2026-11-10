import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Every staff GET that returns one student's record writes a view row
 * through `recordStudentView` (src/lib/audit.ts). Students are TANF/SNAP
 * recipients, and who looked at whose record is a compliance expectation.
 *
 * A route is in scope when its path carries a student id segment
 * (`students/[id]`) or it is listed in `ONE_STUDENT_ROUTES` (routes whose id
 * names a row that belongs to one student). Its GET handler must call
 * `recordStudentView`, or appear in `EXEMPT` with a reason.
 */

const STAFF_API_ROOTS = ["src/app/api/teacher", "src/app/api/admin", "src/app/api/coordinator"];

const STUDENT_ID_SEGMENT = /\/students\/\[id\]\//u;

/** Routes whose dynamic id is not a student id but still names one student's data. */
const ONE_STUDENT_ROUTES: ReadonlySet<string> = new Set([
  "src/app/api/teacher/failed-extractions/[id]/route.ts",
  "src/app/api/teacher/failed-extractions/route.ts",
  "src/app/api/teacher/forms/responses/[id]/route.ts",
]);

/** In-scope GETs that record no view. Every entry needs a reason. */
const EXEMPT: Readonly<Record<string, string>> = {
  "src/app/api/teacher/failed-extractions/route.ts":
    "Lists open failures across every managed student: name, kind, date and status only. " +
    "It returns no conversation text and no error text; the detail route returns those and records the read.",
};

function staffRouteFiles(): string[] {
  return STAFF_API_ROOTS.flatMap((root) =>
    readdirSync(path.join(process.cwd(), root), { recursive: true, encoding: "utf8" })
      .filter((file) => path.basename(file) === "route.ts")
      .map((file) => path.join(root, file)),
  ).sort();
}

/** The source of the exported GET handler, up to the next export. */
function getHandlerSource(source: string): string | null {
  const start = source.search(/export (const|async function) GET\b/u);
  if (start === -1) return null;
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport (const|async function) /u);
  return next === -1 ? rest : rest.slice(0, next);
}

function inScope(file: string): boolean {
  return STUDENT_ID_SEGMENT.test(file) || ONE_STUDENT_ROUTES.has(file);
}

function scopedGetRoutes(): Map<string, string> {
  const routes = new Map<string, string>();
  for (const file of staffRouteFiles()) {
    if (!inScope(file)) continue;
    const handler = getHandlerSource(readFileSync(file, "utf8"));
    if (handler !== null) routes.set(file, handler);
  }
  return routes;
}

describe("staff reads of one student's record are audited", () => {
  const routes = scopedGetRoutes();

  it("finds the routes it guards", () => {
    assert.ok(routes.size >= 14, `expected at least 14 one-student staff GETs, found ${routes.size}`);
    for (const file of ONE_STUDENT_ROUTES) {
      assert.ok(routes.has(file), `${file} is listed but has no GET handler`);
    }
  });

  for (const [file, handler] of routes) {
    it(`${file} GET calls recordStudentView or is exempt with a reason`, () => {
      if (file in EXEMPT) return;
      assert.match(handler, /recordStudentView\(/u, `${file} GET returns one student's data and records no view`);
    });
  }

  it("every exemption has a reason and a route that needs it", () => {
    for (const [file, reason] of Object.entries(EXEMPT)) {
      assert.ok(reason.trim().length > 0, `${file} is exempt with no reason`);
      const handler = routes.get(file);
      assert.ok(handler !== undefined, `${file} is exempt but is not an in-scope GET route`);
      assert.doesNotMatch(handler, /recordStudentView\(/u, `${file} records a view, so its exemption is stale`);
    }
  });
});
