// =============================================================================
// Platform Map Validator — pure function checking PLATFORM_MAP entries against
// the real route tree and agent tool registry. Mirrors the error shape and
// reporting style of src/lib/catalog/validate.ts so both validators read the
// same way in CI/CLI output.
// =============================================================================

import { PLATFORM_MAP, type PlatformFeature, type PlatformRole } from "./platform-map";

export interface PlatformMapError {
  rule: string;
  id: string;
  message: string;
}

export interface PlatformMapRefs {
  /** Every real route path discovered from the four route-group page.tsx trees. */
  routePaths: string[];
  /** Every tool name registered in the agent tool registry. */
  toolNames: string[];
  /** Tool name -> the roles allowed to call it (AgentTool.requiredRoles). */
  toolRoleMap: Record<string, string[]>;
}

const COMPACT_CHAR_LIMIT = 650;
const ALL_ROLES: PlatformRole[] = ["student", "teacher", "coordinator", "admin"];

/**
 * Routes that intentionally have no PLATFORM_MAP entry — plain account
 * utility pages with no coaching surface, or legacy/transitional routes.
 * Keeping this allowlist exported makes exclusions visible and reviewable
 * rather than silently dropped.
 */
export const ROUTE_IGNORE: string[] = [
  "/profile",
  "/settings",
  "/dashboard/classic",
  "/welcome",
  "/forms/[templateId]",
  "/teacher/students/[id]/dashboard",
];

/**
 * Tool names that intentionally have no PLATFORM_MAP entry — internal/
 * cross-cutting tools that aren't tied to a single page surface.
 */
export const TOOL_IGNORE: string[] = ["lookup_program_info", "classify_attachment"];

function normalizeRoute(route: string): string {
  return route.endsWith("/") && route !== "/" ? route.slice(0, -1) : route;
}

/** Does `entryRoute` resolve to one of the real, discovered route paths? */
function routeExists(entryRoute: string, routePaths: string[]): boolean {
  const normalized = normalizeRoute(entryRoute);
  return routePaths.some((path) => normalizeRoute(path) === normalized);
}

export function validatePlatformMap(
  entries: PlatformFeature[],
  refs: PlatformMapRefs,
): PlatformMapError[] {
  const errors: PlatformMapError[] = [];
  const push = (rule: string, id: string, message: string) => errors.push({ rule, id, message });

  // ── id-unique ──────────────────────────────────────────────────────────
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      push("id-unique", entry.id, `duplicate entry id: ${entry.id}`);
    }
    seenIds.add(entry.id);
  }

  // ── roles-nonempty / summary-nonempty / route-exists / tool-exists /
  //    role-tool-consistency ──────────────────────────────────────────────
  const toolRoleMap = refs.toolRoleMap;
  const knownToolNames = new Set(refs.toolNames);

  for (const entry of entries) {
    if (!entry.roles || entry.roles.length === 0) {
      push("roles-nonempty", entry.id, "entry has no roles");
    }
    if (!entry.summary || entry.summary.trim().length === 0) {
      push("summary-nonempty", entry.id, "entry has empty summary");
    }
    if (entry.route && !routeExists(entry.route, refs.routePaths)) {
      push("route-exists", entry.id, `route does not resolve to a real page: ${entry.route}`);
    }
    for (const toolName of entry.tools ?? []) {
      if (!knownToolNames.has(toolName)) {
        push("tool-exists", entry.id, `references unknown tool: ${toolName}`);
        continue;
      }
      const toolRoles = toolRoleMap[toolName] ?? [];
      const sharesRole = entry.roles.some((role) => toolRoles.includes(role));
      if (!sharesRole) {
        push(
          "role-tool-consistency",
          entry.id,
          `tool "${toolName}" requires roles [${toolRoles.join(", ")}] which do not overlap entry roles [${entry.roles.join(", ")}]`,
        );
      }
    }
  }

  // ── route-covered: every discovered route maps to >=1 entry ────────────
  const mappedRoutes = new Set(
    entries.filter((entry) => entry.route).map((entry) => normalizeRoute(entry.route as string)),
  );
  const ignoredRoutes = new Set(ROUTE_IGNORE.map(normalizeRoute));
  for (const routePath of refs.routePaths) {
    const normalized = normalizeRoute(routePath);
    if (mappedRoutes.has(normalized) || ignoredRoutes.has(normalized)) continue;
    push("route-covered", normalized, `route has no PLATFORM_MAP entry and is not in ROUTE_IGNORE: ${routePath}`);
  }

  // ── tool-covered: every registered tool (minus TOOL_IGNORE) is
  //    referenced by >=1 entry whose roles intersect the tool's
  //    requiredRoles ────────────────────────────────────────────────────
  const referencedTools = new Map<string, PlatformRole[]>();
  for (const entry of entries) {
    for (const toolName of entry.tools ?? []) {
      const existing = referencedTools.get(toolName) ?? [];
      referencedTools.set(toolName, [...existing, ...entry.roles]);
    }
  }
  const ignoredTools = new Set(TOOL_IGNORE);
  for (const toolName of refs.toolNames) {
    if (ignoredTools.has(toolName)) continue;
    const toolRoles = toolRoleMap[toolName] ?? [];
    const referencingRoles = referencedTools.get(toolName) ?? [];
    const covered = toolRoles.some((role) => referencingRoles.includes(role as PlatformRole));
    if (!covered) {
      push("tool-covered", toolName, `tool has no PLATFORM_MAP entry covering any of its roles [${toolRoles.join(", ")}] and is not in TOOL_IGNORE`);
    }
  }

  // ── compact-budget: <=650 chars per role render ─────────────────────────
  // Mirrors buildPlatformKnowledge's compact-tier render logic, but against
  // the `entries` argument rather than the module-level PLATFORM_MAP, so
  // this rule is testable against crafted entries.
  for (const role of ALL_ROLES) {
    const compactEntries = entries.filter((entry) => entry.roles.includes(role) && Boolean(entry.compact));
    const rendered =
      compactEntries.length === 0
        ? ""
        : `VISIONQUEST PLATFORM: ${compactEntries.map((entry) => entry.compact).join("; ")}.`;
    if (rendered.length > COMPACT_CHAR_LIMIT) {
      push(
        "compact-budget",
        role,
        `compact render for role "${role}" is ${rendered.length} chars, exceeds ${COMPACT_CHAR_LIMIT}`,
      );
    }
  }

  return errors;
}

export function validateRealPlatformMap(refs: PlatformMapRefs): PlatformMapError[] {
  return validatePlatformMap(PLATFORM_MAP, refs);
}
