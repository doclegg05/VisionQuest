import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { Session } from "@/lib/api-error";
import { getTool } from "@/lib/registry";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { ApiError } from "@/lib/api-error";
import { resolvePermission } from "@/lib/rbac";
import type { ToolDefinition } from "@/lib/registry/types";

interface RouteContext {
  params: Promise<Record<string, string>>;
}

type RegistryHandler = (
  session: Session,
  req: NextRequest,
  ctx: RouteContext,
  tool: ToolDefinition,
) => Promise<Response>;

/**
 * Registry-enforced route handler.
 * Looks up the tool by ID, checks enabled/role/feature-flag,
 * logs audit events per auditLevel, then executes the handler.
 *
 * Permission check order:
 *   1. RBAC database lookup via resolvePermission()
 *   2. Falls back to static requiredRoles array only if RBAC is unavailable/unseeded
 *
 * Usage:
 *   export const GET = withRegistry("goals.list", async (session, req, ctx, tool) => { ... });
 */
export function withRegistry(toolId: string, handler: RegistryHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    try {
      const tool = getTool(toolId);
      if (!tool) {
        return NextResponse.json(
          { error: "Unknown capability", code: "UNKNOWN_TOOL" },
          { status: 500 },
        );
      }

      if (!tool.enabled) {
        return NextResponse.json(
          { error: "This feature is currently unavailable.", code: "TOOL_DISABLED" },
          { status: 503 },
        );
      }

      const session = await getSession();
      if (!session) {
        return NextResponse.json(
          { error: "Unauthorized", code: "UNAUTHORIZED" },
          { status: 401 },
        );
      }

      // RBAC check — query the database for granular permissions.
      // Falls back to the static requiredRoles array when the RBAC
      // tables have not been seeded yet (hasPermission returns false
      // for every key when the tables are empty).
      const permission = await resolvePermission(session.role, toolId);

      if (!permission.allowed) {
        if (permission.source === "rbac") {
          return NextResponse.json(
            { error: "Forbidden", code: "FORBIDDEN" },
            { status: 403 },
          );
        }

        // Fallback: check the static requiredRoles array from the registry.
        // This keeps the system functional before RBAC is seeded or available.
        const staticAllowed = tool.requiredRoles.includes(
          session.role as ToolDefinition["requiredRoles"][number],
        );
        if (!staticAllowed) {
          return NextResponse.json(
            { error: "Forbidden", code: "FORBIDDEN" },
            { status: 403 },
          );
        }
      }

      if (tool.auditLevel === "basic" || tool.auditLevel === "full") {
        void logAuditEvent({
          actorId: session.id,
          actorRole: session.role,
          action: `${toolId}.accessed`,
          targetType: tool.namespace,
          targetId: null,
          summary: `Accessed ${tool.name}`,
        });
      }

      return await handler(session, req, ctx, tool);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.statusCode },
        );
      }
      logger.error("Unhandled error in registry middleware", { error: String(err), toolId });
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}

/**
 * Registry-enforced handler for unauthenticated routes.
 * Only checks tool existence and enabled status.
 */
export function withRegistryPublic(
  toolId: string,
  handler: (req: NextRequest, ctx: RouteContext, tool: ToolDefinition) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const tool = getTool(toolId);
    if (!tool || !tool.enabled) {
      return NextResponse.json({ error: "Feature unavailable" }, { status: 503 });
    }
    return handler(req, ctx, tool);
  };
}
