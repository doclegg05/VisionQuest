export function getRoleHomePath(role: string) {
  if (role === "admin") return "/admin";
  if (role === "coordinator") return "/coordinator";
  if (role === "teacher") return "/teacher";
  if (role === "cdc") return "/cdc";
  return "/dashboard";
}
