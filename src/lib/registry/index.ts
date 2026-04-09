import { TOOLS } from "./tools";
import type { ToolDefinition, Role, ToolNamespace } from "./types";

export type { ToolDefinition, Role, ToolNamespace, AuditLevel } from "./types";
export { TOOLS } from "./tools";

/** Get all registered tools */
export function getAllTools(): readonly ToolDefinition[] {
  return TOOLS;
}

/** Get a tool by ID */
export function getTool(id: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** Get all tools available to a specific role */
export function getToolsForRole(role: Role): ToolDefinition[] {
  return TOOLS.filter((t) => t.enabled && t.requiredRoles.includes(role));
}

/** Get all tools in a namespace */
export function getToolsByNamespace(
  namespace: ToolNamespace,
): ToolDefinition[] {
  return TOOLS.filter((t) => t.namespace === namespace);
}

/** Get all AI-powered tools (have tokenBudget) */
export function getAiTools(): ToolDefinition[] {
  return TOOLS.filter((t) => t.tokenBudget !== undefined);
}

/** Get all tools that require full audit logging */
export function getFullAuditTools(): ToolDefinition[] {
  return TOOLS.filter((t) => t.auditLevel === "full");
}

/** Get all tools with a specific feature flag */
export function getToolsByFeatureFlag(flag: string): ToolDefinition[] {
  return TOOLS.filter((t) => t.featureFlag === flag);
}

/** Check if a role has access to a specific tool */
export function canAccess(role: Role, toolId: string): boolean {
  const tool = getTool(toolId);
  if (!tool) return false;
  if (!tool.enabled) return false;
  return tool.requiredRoles.includes(role);
}

/** Get all tools matching a specific tag */
export function getToolsByTag(tag: string): ToolDefinition[] {
  return TOOLS.filter((t) => t.tags?.includes(tag));
}

/** Get a summary of capabilities by role */
export function getCapabilitySummary(): Record<
  Role,
  { total: number; namespaces: ToolNamespace[] }
> {
  const roles: Role[] = ["student", "teacher", "admin"];
  const result = {} as Record<
    Role,
    { total: number; namespaces: ToolNamespace[] }
  >;
  for (const role of roles) {
    const tools = getToolsForRole(role);
    const namespaces = [...new Set(tools.map((t) => t.namespace))];
    result[role] = { total: tools.length, namespaces };
  }
  return result;
}
