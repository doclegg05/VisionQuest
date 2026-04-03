import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import {
  getAllTools,
  getToolsForRole,
  getToolsByNamespace,
  getCapabilitySummary,
} from "@/lib/registry";
import type { Role, ToolNamespace } from "@/lib/registry";

const VALID_ROLES: ReadonlySet<string> = new Set<Role>([
  "student",
  "teacher",
  "admin",
]);
const VALID_NAMESPACES: ReadonlySet<string> = new Set<ToolNamespace>([
  "auth",
  "sage",
  "goals",
  "orientation",
  "certifications",
  "portfolio",
  "career",
  "advising",
  "files",
  "learning",
  "notifications",
  "progression",
  "admin",
  "reports",
  "classes",
  "spokes",
]);

/**
 * GET /api/admin/registry — returns the full tool registry (admin only)
 *
 * Query parameters:
 *   ?role=student      — filter tools available to a specific role
 *   ?namespace=sage    — filter tools in a specific namespace
 *   ?summary=true      — return capability summary by role instead of full list
 */
export const GET = withAdminAuth(async (_session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const role = searchParams.get("role");
  const namespace = searchParams.get("namespace");
  const summary = searchParams.get("summary");

  // Summary mode: return counts and namespace lists per role
  if (summary === "true") {
    return NextResponse.json({ summary: getCapabilitySummary() });
  }

  // Filter by role
  if (role) {
    if (!VALID_ROLES.has(role)) {
      return NextResponse.json(
        { error: `Invalid role: ${role}. Valid roles: student, teacher, admin` },
        { status: 400 },
      );
    }
    const tools = getToolsForRole(role as Role);
    return NextResponse.json({ tools, count: tools.length });
  }

  // Filter by namespace
  if (namespace) {
    if (!VALID_NAMESPACES.has(namespace)) {
      return NextResponse.json(
        {
          error: `Invalid namespace: ${namespace}. Valid namespaces: ${[...VALID_NAMESPACES].join(", ")}`,
        },
        { status: 400 },
      );
    }
    const tools = getToolsByNamespace(namespace as ToolNamespace);
    return NextResponse.json({ tools, count: tools.length });
  }

  // Default: return everything
  const tools = getAllTools();
  return NextResponse.json({ tools, count: tools.length });
});
