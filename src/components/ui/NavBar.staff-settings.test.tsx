import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the staff MFA reachability bug: StaffMfaPanel was only
// mounted under (student)/settings, but (student)/layout.tsx redirects every
// non-student role to its role home, and the NavBar settings links were
// student-only — so teachers and admins could never reach MFA enrollment.

test("a settings page is mounted in the staff-accessible (teacher) route group", () => {
  const staffSettingsPage = join(
    process.cwd(),
    "src",
    "app",
    "(teacher)",
    "teacher",
    "settings",
    "page.tsx",
  );
  assert.ok(
    existsSync(staffSettingsPage),
    "staff settings must live in a route group whose layout admits teacher/admin — (student)/settings redirects staff away",
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

test("the NavBar settings links are keyed on the role's settings path, not role === student", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(join(process.cwd(), "src/components/ui/NavBar.tsx"), "utf8");

  assert.ok(
    source.includes("getRoleSettingsPath"),
    "NavBar must resolve the settings href per role — a hardcoded /settings is unreachable for staff",
  );
  assert.ok(
    !/role === "student" && \(\s*<Link\s+href="\/settings"/.test(source),
    "NavBar must not gate the settings link on role === 'student'",
  );
  assert.ok(
    !source.includes('href="/settings"'),
    "NavBar must not hardcode /settings — staff get redirected out of the (student) group",
  );
});
