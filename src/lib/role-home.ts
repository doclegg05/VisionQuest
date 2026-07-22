export function getRoleHomePath(role: string) {
  if (role === "admin") return "/admin";
  if (role === "coordinator") return "/coordinator";
  if (role === "teacher") return "/teacher";
  if (role === "cdc") return "/cdc";
  return "/dashboard";
}

// The (teacher) layout admits both teacher and admin, matching the
// withTeacherAuth gate on the MFA endpoints — both roles share one surface.
// Roles without a settings surface (coordinator, cdc) get null: render no link.
export function getRoleSettingsPath(role: string): string | null {
  if (role === "student") return "/settings";
  if (role === "teacher" || role === "admin") return "/teacher/settings";
  return null;
}
