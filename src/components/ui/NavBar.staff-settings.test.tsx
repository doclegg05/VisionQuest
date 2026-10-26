import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the staff MFA reachability bug: StaffMfaPanel was only
// mounted under (student)/settings, but (student)/layout.tsx redirects every
// non-student role to its role home, and the NavBar settings links were
// student-only — so teachers and admins could never reach MFA enrollment.

/**
 * Extracts the set of roles a route-group layout ADMITS from its
 * `if (session.role !== "a" && session.role !== "b") { redirect(...) }`
 * guard: every role compared with `!==` there is a role the whole
 * condition is false for — i.e. one the layout does NOT redirect away.
 */
function extractAdmittedRoles(layoutSource: string): string[] {
  const guard = layoutSource.match(
    /if \(([^)]*session\.role !== "[^)]*)\)\s*\{\s*redirect\(getRoleHomePath\(session\.role\)\)/,
  );
  if (!guard) return [];
  return [...guard[1].matchAll(/session\.role !== "([a-z]+)"/g)].map((m) => m[1]);
}

test("extractAdmittedRoles reads the roles a guard admits, not the ones it redirects", () => {
  assert.deepEqual(
    extractAdmittedRoles(
      'if (session.role !== "teacher" && session.role !== "admin") { redirect(getRoleHomePath(session.role)); }',
    ),
    ["teacher", "admin"],
  );
  assert.deepEqual(
    extractAdmittedRoles('if (session.role !== "student") { redirect(getRoleHomePath(session.role)); }'),
    ["student"],
  );
  assert.deepEqual(extractAdmittedRoles("no guard here at all"), []);
});

// The invariant this regression guard actually needs: if a role is ever
// admitted by BOTH layouts, that role's staff-only (or student-only)
// surfaces silently become reachable — or unreachable — for the wrong
// audience again, the same shape as the original MFA bug. Proven against a
// deliberately broken fixture before it is trusted against the real files.
test("the admitted-role invariant catches an overlap between the two layouts", () => {
  const brokenTeacherSource =
    'if (session.role !== "teacher" && session.role !== "admin") { redirect(getRoleHomePath(session.role)); }';
  // A hypothetical regression: (student) starts admitting "teacher" too.
  const brokenStudentSource =
    'if (session.role !== "student" && session.role !== "teacher") { redirect(getRoleHomePath(session.role)); }';

  const teacherAdmits = extractAdmittedRoles(brokenTeacherSource);
  const studentAdmits = extractAdmittedRoles(brokenStudentSource);
  const overlap = teacherAdmits.filter((role) => studentAdmits.includes(role));

  assert.deepEqual(
    overlap,
    ["teacher"],
    "the fixture is built to overlap on 'teacher' — if this is empty, the overlap detector itself is broken",
  );
});

test("the (teacher) layout admits exactly teacher and admin, and the (student) layout admits neither", () => {
  const teacherSource = readFileSync(join(process.cwd(), "src/app/(teacher)/layout.tsx"), "utf8");
  const studentSource = readFileSync(join(process.cwd(), "src/app/(student)/layout.tsx"), "utf8");

  const teacherAdmits = [...extractAdmittedRoles(teacherSource)].sort();
  const studentAdmits = [...extractAdmittedRoles(studentSource)].sort();

  assert.deepEqual(
    teacherAdmits,
    ["admin", "teacher"],
    "the (teacher) layout must admit exactly teacher and admin — the MFA endpoints use withTeacherAuth for both",
  );
  assert.deepEqual(studentAdmits, ["student"], "the (student) layout must admit only student");

  const overlap = teacherAdmits.filter((role) => studentAdmits.includes(role));
  assert.deepEqual(
    overlap,
    [],
    `a role admitted by both layouts means it is reachable somewhere the other layout also thinks it owns: ${overlap.join(", ")}`,
  );
});

test("every role with MFA API access maps to a reachable settings path", async () => {
  const roleHome = (await import("@/lib/role-home")) as {
    getRoleSettingsPath?: (role: string) => string | null;
  };
  assert.ok(
    roleHome.getRoleSettingsPath,
    "role-home must export getRoleSettingsPath so NavBar and the chat error banner can link roles to the right settings surface",
  );
  const getRoleSettingsPath = roleHome.getRoleSettingsPath;

  assert.equal(getRoleSettingsPath("student"), "/settings");
  // The MFA endpoints use withTeacherAuth (teacher + admin), and the (teacher)
  // layout admits both roles — so both must land on /teacher/settings.
  assert.equal(getRoleSettingsPath("teacher"), "/teacher/settings");
  assert.equal(getRoleSettingsPath("admin"), "/teacher/settings");
  // Roles without a settings surface get no link at all.
  assert.equal(getRoleSettingsPath("coordinator"), null);
  assert.equal(getRoleSettingsPath("cdc"), null);
});
