#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROUTE_GROUPS = ["(student)", "(teacher)", "(admin)", "(coordinator)"];

/** Recursively find every page.tsx under `dir`, relative to `dir`. */
function findPageFiles(dir) {
  const results = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === "page.tsx") {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results;
}

/**
 * Convert a Next.js App Router file path to its route path, following the
 * same convention used by src/lib/sage/platform-map.ts entries:
 *   - route groups `(student)` etc. are stripped
 *   - dynamic segments `[id]` are kept literally
 *   - trailing `/page.tsx` is dropped
 */
function toRoutePath(appDir, filePath) {
  const rel = relative(appDir, filePath).split(sep);
  rel.pop(); // drop page.tsx
  const segments = rel.filter((seg) => !ROUTE_GROUPS.includes(seg));
  return "/" + segments.join("/");
}

async function main() {
  const appDir = "src/app";
  const routePaths = [];
  for (const group of ROUTE_GROUPS) {
    const groupDir = join(appDir, group);
    if (!statSync(groupDir, { throwIfNoEntry: false })) continue;
    for (const pageFile of findPageFiles(groupDir)) {
      routePaths.push(toRoutePath(appDir, pageFile));
    }
  }

  const { validatePlatformMap } = await import("../../src/lib/sage/platform-map-validate.ts");
  const { PLATFORM_MAP } = await import("../../src/lib/sage/platform-map.ts");

  // Pull every registered tool + its requiredRoles by unioning
  // getEnabledTools() across all four roles (there is no single exported
  // "all tools" list), then reconciling with getToolByName so the role set
  // reflects the tool's *declared* requiredRoles rather than the runtime
  // admin-superset behavior in getEnabledTools.
  const { getEnabledTools, getToolByName } = await import("../../src/lib/sage/agent/tools.ts");
  const toolNameSet = new Set();
  for (const role of ["student", "teacher", "admin", "coordinator"]) {
    for (const tool of getEnabledTools(role)) toolNameSet.add(tool.name);
  }
  const toolNames = [...toolNameSet];
  const toolRoleMap = {};
  for (const name of toolNames) {
    const tool = getToolByName(name);
    toolRoleMap[name] = tool ? [...tool.requiredRoles] : [];
  }

  const errors = validatePlatformMap(PLATFORM_MAP, { routePaths, toolNames, toolRoleMap });

  if (errors.length) {
    for (const e of errors) console.error(`[${e.rule}] ${e.id}: ${e.message}`);
    console.error(`\n${errors.length} validation error(s).`);
    process.exit(1);
  }
  console.log(`Platform map valid: ${PLATFORM_MAP.length} entries, ${routePaths.length} routes, ${toolNames.length} tools, 0 errors.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
