import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEMO_INSTRUCTOR_READ_DENY,
  DEMO_INSTRUCTOR_WRITE_ALLOW,
  DEMO_INSTRUCTOR_WRITE_DENY,
  isDemoInstructorRequestAllowed,
  matchesRoutePattern,
} from "./instructor-policy";

// ---------------------------------------------------------------------------
// The route walk
//
// The fence is default-deny, so a route missing from both lists is already
// refused. The walk exists so that nobody has to guess: every state-changing
// handler under src/app/api is named in exactly one list, and every name in a
// list points at a handler that exists. The second half catches a typo in
// WRITE_ALLOW, which would otherwise refuse an everyday action without a sound.
// ---------------------------------------------------------------------------

const API_DIR = path.join(process.cwd(), "src/app/api");
const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** The given HTTP methods a route file exports, in any of the forms this repo uses. */
function exportedMethods(source: string, wanted: readonly string[]): string[] {
  const exported = new Set<string>();
  // `export const POST = ...`, `export async function POST`, `export function POST`
  for (const match of source.matchAll(/^export\s+(?:async\s+function|function|const)\s+([A-Z]+)\b/gm)) {
    exported.add(match[1]);
  }
  // `export { handler as POST }`, `export { POST } from "./x"`
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) exported.add(name);
    }
  }
  return wanted.filter((method) => exported.has(method));
}

/** `(group)` folders are not part of a URL; `[param]` folders stay as written. */
function urlPathForRouteFile(relativeFile: string): string {
  const segments = path
    .dirname(relativeFile)
    .split(path.sep)
    .filter((segment) => segment !== "." && !/^\(.*\)$/.test(segment));
  return ["/api", ...segments].join("/");
}

/** "METHOD /api/path" → the route file's source, for every handler of the given methods under src/app/api. */
function routeSourcesFor(wanted: readonly string[]): Map<string, string> {
  const sources = new Map<string, string>();
  const files = readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => path.basename(file) === "route.ts")
    // A folder that starts with an underscore is private to Next.js and has no URL.
    .filter((file) => !file.split(path.sep).some((segment) => segment.startsWith("_")));
  for (const file of files) {
    const source = readFileSync(path.join(API_DIR, file), "utf8");
    for (const method of exportedMethods(source, wanted)) sources.set(`${method} ${urlPathForRouteFile(file)}`, source);
  }
  return sources;
}

/** "METHOD /api/path" for every handler of the given methods under src/app/api. */
function routeKeysFor(wanted: readonly string[]): string[] {
  return [...routeSourcesFor(wanted).keys()].sort();
}

/**
 * The WRITE_ALLOW entries that touch only the caller's own rows, or whose
 * student check lives outside the route file. Every other allowed write acts
 * on a student or a class and must check it in the route itself.
 */
const ALLOWED_WITHOUT_A_ROUTE_CHECK: Readonly<Record<string, string>> = {
  "POST /api/teacher/availability": "the caller's own appointment slots",
  "DELETE /api/teacher/availability/[id]": "the caller's own appointment slots",
  "POST /api/chat/send":
    "the caller's own conversation; a named student resolves in src/lib/sage/staff-student-context.ts and Sage's tools check it in src/lib/sage/agent/executor.ts",
  "POST /api/chat/tool-confirm": "src/lib/sage/agent/executor.ts checks the target student",
  "DELETE /api/auth/session": "signs the caller out",
  "POST /api/notifications": "the caller's own notifications",
  "DELETE /api/chat/conversations/[id]": "the caller's own conversation",
  "POST /api/sage/panel/dismiss": "dismissPanel in src/lib/sage/panel-data.ts checks the student",
  "POST /api/demo/student": "demo entry, before any session exists",
  "POST /api/demo/instructor": "demo entry, before any session exists",
  "PATCH /api/tasks/[id]":
    "updateTasks -> scopedTask in src/lib/dashboard/tasks.ts checks the student with buildManagedStudentWhere",
  "PATCH /api/tasks/bulk-status":
    "updateTasks -> scopedTask in src/lib/dashboard/tasks.ts checks each task's student with buildManagedStudentWhere",
};

/** The helpers that hold a teacher to the students and classes they may manage. */
const MANAGE_CHECKS = [
  "assertStaffCanManageStudent",
  "assertStaffCanManageClass",
  "buildManagedStudentWhere",
  "listManagedStudentIds",
] as const;

/** Route source with block and line comments removed, so only code is searched. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const listed = [...DEMO_INSTRUCTOR_WRITE_ALLOW, ...DEMO_INSTRUCTOR_WRITE_DENY];

describe("demo instructor route walk", () => {
  const routeKeys = routeKeysFor(MUTATING_METHODS);
  const getKeys = routeKeysFor(["GET"]);

  it("finds the routes it is meant to classify", () => {
    assert.ok(routeKeys.length > 100, `expected over 100 state-changing handlers, found ${routeKeys.length}`);
    assert.ok(routeKeys.includes("POST /api/chat/send"));
    assert.ok(routeKeys.includes("DELETE /api/teacher/students/[id]/notes"));
  });

  it("classifies every state-changing route exactly once", () => {
    for (const key of routeKeys) {
      const hits = listed.filter((entry) => entry === key);
      assert.equal(hits.length, 1, `${key} must appear exactly once across ALLOW and DENY, found ${hits.length}`);
    }
  });

  it("names only routes that exist", () => {
    const known = new Set(routeKeys);
    for (const entry of listed) {
      assert.ok(known.has(entry), `${entry} names no route file or no exported method`);
    }
  });

  // READ_DENY is the one list that fails open: a pattern that matches no real
  // route denies nothing, and every other test would still pass. So each entry
  // has to land on a GET handler that exists, and a "/**" entry on at least one
  // under it. A renamed folder or a typo now fails here by name.
  it("points every READ_DENY entry at a real GET handler", () => {
    assert.ok(getKeys.includes("GET /api/teacher/export"), "the walk must see GET handlers");
    for (const entry of DEMO_INSTRUCTOR_READ_DENY) {
      const covered = entry.endsWith("/**")
        ? getKeys.some((key) => matchesRoutePattern(entry, "GET", key.split(" ")[1]))
        : getKeys.includes(entry);
      assert.ok(covered, `${entry} matches no GET handler under src/app/api`);
    }
  });

  // The file header's rule for WRITE_ALLOW: a route acts on one student or one
  // class "through assertStaffCanManageStudent or assertStaffCanManageClass".
  // Without that check, only RLS and an unguessable id keep the demo
  // instructor inside its class.
  it("checks the student or class in every allowed write that acts on one", () => {
    const sources = routeSourcesFor(MUTATING_METHODS);
    for (const entry of DEMO_INSTRUCTOR_WRITE_ALLOW) {
      if (entry in ALLOWED_WITHOUT_A_ROUTE_CHECK) continue;
      // A call, not a mention: an import or a comment naming the helper must not count.
      const code = withoutComments(sources.get(entry) ?? "");
      assert.ok(
        MANAGE_CHECKS.some((check) => new RegExp(`\\b${check}\\s*\\(`).test(code)),
        `${entry} is on WRITE_ALLOW but its route calls none of ${MANAGE_CHECKS.join(", ")}`,
      );
    }
  });

  it("counts a manage check only when the route calls it", () => {
    const importedOnly = 'import { assertStaffCanManageStudent } from "@/lib/classroom";\n// assertStaffCanManageStudent(session, id)\n';
    const called = `${importedOnly}await assertStaffCanManageStudent(session, goal.studentId);\n`;
    const calls = (source: string) => /\bassertStaffCanManageStudent\s*\(/.test(withoutComments(source));
    assert.equal(calls(importedOnly), false);
    assert.equal(calls(called), true);
  });

  it("exempts only entries that are on WRITE_ALLOW", () => {
    for (const entry of Object.keys(ALLOWED_WITHOUT_A_ROUTE_CHECK)) {
      assert.ok(DEMO_INSTRUCTOR_WRITE_ALLOW.includes(entry), `${entry} is exempted but not allowed`);
    }
  });
});

// ---------------------------------------------------------------------------
// The lists themselves
// ---------------------------------------------------------------------------

const ENTRY_SHAPE = /^(GET|POST|PUT|PATCH|DELETE) \/api\/\S+$/;

/** Fills a pattern's `[param]` segments so it reads as a real request path. */
function concretePath(pattern: string): string {
  return pattern
    .split(" ")[1]
    .replace(/\/\*\*$/, "/anything/deeper")
    .replace(/\[\.\.\.[^\]]+\]/g, "a/b")
    .replace(/\[[^\]]+\]/g, "abc");
}

describe("demo instructor lists", () => {
  it("holds well-formed entries only", () => {
    for (const entry of [...listed, ...DEMO_INSTRUCTOR_READ_DENY]) {
      assert.match(entry, ENTRY_SHAPE, entry);
    }
  });

  it("uses only mutating methods in the write lists and only GET in the read list", () => {
    for (const entry of listed) assert.ok(!entry.startsWith("GET "), entry);
    for (const entry of DEMO_INSTRUCTOR_READ_DENY) assert.ok(entry.startsWith("GET "), entry);
  });

  it("repeats no entry", () => {
    assert.equal(new Set(listed).size, listed.length);
    assert.equal(new Set(DEMO_INSTRUCTOR_READ_DENY).size, DEMO_INSTRUCTOR_READ_DENY.length);
  });

  it("lets every ALLOW entry through", () => {
    for (const entry of DEMO_INSTRUCTOR_WRITE_ALLOW) {
      const [method] = entry.split(" ");
      assert.equal(isDemoInstructorRequestAllowed(method, concretePath(entry)), true, entry);
    }
  });

  it("refuses every DENY entry, so no broader ALLOW pattern swallows one", () => {
    for (const entry of DEMO_INSTRUCTOR_WRITE_DENY) {
      const [method] = entry.split(" ");
      assert.equal(isDemoInstructorRequestAllowed(method, concretePath(entry)), false, entry);
    }
  });

  it("refuses every READ_DENY entry", () => {
    for (const entry of DEMO_INSTRUCTOR_READ_DENY) {
      assert.equal(isDemoInstructorRequestAllowed("GET", concretePath(entry)), false, entry);
    }
  });
});

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

describe("isDemoInstructorRequestAllowed", () => {
  it("allows the everyday class actions", () => {
    assert.equal(isDemoInstructorRequestAllowed("POST", "/api/teacher/students/abc/notes"), true);
    assert.equal(isDemoInstructorRequestAllowed("PATCH", "/api/teacher/alerts/abc"), true);
    assert.equal(isDemoInstructorRequestAllowed("DELETE", "/api/auth/session"), true);
  });

  it("allows the writes that touch only the caller's own rows", () => {
    assert.equal(isDemoInstructorRequestAllowed("POST", "/api/notifications"), true);
    assert.equal(isDemoInstructorRequestAllowed("DELETE", "/api/chat/conversations/abc"), true);
    assert.equal(isDemoInstructorRequestAllowed("POST", "/api/sage/panel/dismiss"), true);
    // Preferences carry a phone number and an email, so they stay refused.
    assert.equal(isDemoInstructorRequestAllowed("PUT", "/api/notifications/preferences"), false);
  });

  it("refuses program-wide, credential and sending routes, and unknown writes", () => {
    const refused: Array<[string, string]> = [
      ["POST", "/api/teacher/sage-snippets"],
      ["POST", "/api/teacher/welcome-letter"],
      ["POST", "/api/auth/mfa/setup"],
      ["POST", "/api/teacher/connect/connections/abc/send"],
      ["POST", "/api/teacher/classes/abc/students"],
      ["PATCH", "/api/teacher/classes/abc"],
      ["POST", "/api/teacher/appointments/reminders"],
      ["POST", "/api/not-a-route"],
    ];
    for (const [method, pathname] of refused) {
      assert.equal(isDemoInstructorRequestAllowed(method, pathname), false, `${method} ${pathname}`);
    }
  });

  it("allows program-wide reads but not cross-class reports", () => {
    assert.equal(isDemoInstructorRequestAllowed("GET", "/api/teacher/sage-snippets"), true);
    assert.equal(isDemoInstructorRequestAllowed("GET", "/api/teacher/reports/grant-kpi/history"), false);
  });

  it("refuses each cross-class and staff-list read the spec names", () => {
    for (const pathname of [
      "/api/teacher/reports/spokes",
      "/api/teacher/spokes/referrals",
      "/api/teacher/failed-extractions",
      "/api/teacher/forms/responses",
      "/api/teacher/export",
      "/api/teacher/audit",
    ]) {
      assert.equal(isDemoInstructorRequestAllowed("GET", pathname), false, pathname);
    }
  });

  it("refuses a route added under the export and audit reads", () => {
    for (const pathname of ["/api/teacher/export/csv", "/api/teacher/export/abc/file", "/api/teacher/audit/abc"]) {
      assert.equal(isDemoInstructorRequestAllowed("GET", pathname), false, pathname);
    }
  });

  it("treats HEAD as the GET it runs, and leaves OPTIONS alone", () => {
    assert.equal(isDemoInstructorRequestAllowed("HEAD", "/api/teacher/export"), false);
    assert.equal(isDemoInstructorRequestAllowed("HEAD", "/api/teacher/sage-snippets"), true);
    assert.equal(isDemoInstructorRequestAllowed("OPTIONS", "/api/teacher/sage-snippets"), true);
  });

  it("matches the method, ignoring case in the request", () => {
    assert.equal(isDemoInstructorRequestAllowed("post", "/api/teacher/students/abc/notes"), true);
    assert.equal(isDemoInstructorRequestAllowed("PUT", "/api/teacher/students/abc/tasks"), false);
    assert.equal(isDemoInstructorRequestAllowed("TRACE", "/api/teacher/students/abc/notes"), false);
  });

  it("polices only /api/ paths", () => {
    assert.equal(isDemoInstructorRequestAllowed("POST", "/teacher/students"), true);
    assert.equal(isDemoInstructorRequestAllowed("GET", "/teacher/reports"), true);
    assert.equal(isDemoInstructorRequestAllowed("POST", "/"), true);
  });

  it("sees through slash, encoding and trailing-slash variants of a refused path", () => {
    for (const [method, pathname] of [
      ["GET", "/api/teacher/export/"],
      ["GET", "/api/teacher//export"],
      ["GET", "//api/teacher/export"],
      ["GET", "/api/teacher/%65xport"],
      ["GET", "/api/teacher/reports/%67rant-kpi"],
      ["POST", "/api/teacher/sage-snippets/"],
      ["POST", "/api/teacher/sage%2Dsnippets"],
    ]) {
      assert.equal(isDemoInstructorRequestAllowed(method, pathname), false, `${method} ${pathname}`);
    }
  });

  it("refuses a path with a broken escape instead of guessing", () => {
    assert.equal(isDemoInstructorRequestAllowed("GET", "/api/teacher/%E0%A4%A"), false);
    assert.equal(isDemoInstructorRequestAllowed("POST", "/api/teacher/students/abc/notes%"), false);
  });

  it("does not let an extra or missing segment turn into a match", () => {
    assert.equal(isDemoInstructorRequestAllowed("POST", "/api/teacher/students/notes"), false);
    assert.equal(isDemoInstructorRequestAllowed("POST", "/api/teacher/students/abc/def/notes"), false);
    assert.equal(isDemoInstructorRequestAllowed("POST", "/api/teacher/students//notes"), false);
  });
});

describe("matchesRoutePattern", () => {
  it("matches a literal path and the method that goes with it", () => {
    assert.equal(matchesRoutePattern("POST /api/orientation", "POST", "/api/orientation"), true);
    assert.equal(matchesRoutePattern("POST /api/orientation", "PUT", "/api/orientation"), false);
    assert.equal(matchesRoutePattern("POST /api/orientation", "POST", "/api/orientation/complete"), false);
  });

  it("lets a [param] segment stand for exactly one segment", () => {
    const pattern = "PATCH /api/tasks/[id]";
    assert.equal(matchesRoutePattern(pattern, "PATCH", "/api/tasks/abc"), true);
    assert.equal(matchesRoutePattern(pattern, "PATCH", "/api/tasks"), false);
    assert.equal(matchesRoutePattern(pattern, "PATCH", "/api/tasks/abc/def"), false);
  });

  it("lets a [...param] segment stand for the rest", () => {
    const pattern = "POST /api/files/[...key]";
    assert.equal(matchesRoutePattern(pattern, "POST", "/api/files/a"), true);
    assert.equal(matchesRoutePattern(pattern, "POST", "/api/files/a/b/c"), true);
    assert.equal(matchesRoutePattern(pattern, "POST", "/api/files"), false);
  });

  it("lets a trailing /** stand for the folder and everything under it", () => {
    const pattern = "GET /api/teacher/reports/**";
    assert.equal(matchesRoutePattern(pattern, "GET", "/api/teacher/reports/spokes"), true);
    assert.equal(matchesRoutePattern(pattern, "GET", "/api/teacher/reports/connect/export.csv"), true);
    assert.equal(matchesRoutePattern(pattern, "GET", "/api/teacher/reports"), true);
    assert.equal(matchesRoutePattern(pattern, "GET", "/api/teacher/reportsX"), false);
    assert.equal(matchesRoutePattern(pattern, "GET", "/api/teacher/other"), false);
  });

  it("never matches a pattern with no method and path", () => {
    assert.equal(matchesRoutePattern("/api/orientation", "POST", "/api/orientation"), false);
    assert.equal(matchesRoutePattern("", "POST", "/api/orientation"), false);
  });
});

describe("cohort intake packet export", () => {
  it("is denied to the demo instructor (signed intake packets are real PII)", () => {
    assert.equal(
      isDemoInstructorRequestAllowed("GET", "/api/teacher/classes/export-packets"),
      false,
    );
  });
});
