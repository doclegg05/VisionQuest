export function getRoleHomePath(role: string) {
  if (role === "admin") return "/admin";
  if (role === "coordinator") return "/coordinator";
  if (role === "teacher") return "/teacher";
  if (role === "cdc") return "/cdc";
  return "/dashboard";
}

/**
 * Where a role's settings surface actually lives.
 *
 * `/settings` sits in the (student) route group, whose layout redirects every
 * non-student role to its role home — so linking staff there is a dead end.
 * The (teacher) layout admits teacher AND admin, matching the withTeacherAuth
 * gate on the MFA endpoints StaffMfaPanel calls, so both roles share
 * `/teacher/settings`. Roles with no settings surface return null: render no
 * link at all rather than one that bounces.
 */
export function getRoleSettingsPath(role: string): string | null {
  if (role === "student") return "/settings";
  if (role === "teacher" || role === "admin") return "/teacher/settings";
  return null;
}
