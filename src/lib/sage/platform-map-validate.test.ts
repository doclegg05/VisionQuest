import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLATFORM_MAP, type PlatformFeature } from "./platform-map";
import { validatePlatformMap, validateRealPlatformMap, type PlatformMapRefs } from "./platform-map-validate";

const REAL_ROUTE_PATHS = [...new Set(PLATFORM_MAP.filter((e) => e.route).map((e) => e.route as string))];
const REAL_TOOL_ROLE_MAP: Record<string, string[]> = {};
for (const entry of PLATFORM_MAP) {
  for (const tool of entry.tools ?? []) {
    REAL_TOOL_ROLE_MAP[tool] = [...new Set([...(REAL_TOOL_ROLE_MAP[tool] ?? []), ...entry.roles])];
  }
}
const REAL_TOOL_NAMES = Object.keys(REAL_TOOL_ROLE_MAP);

function baseRefs(): PlatformMapRefs {
  return {
    routePaths: REAL_ROUTE_PATHS,
    toolNames: REAL_TOOL_NAMES,
    toolRoleMap: REAL_TOOL_ROLE_MAP,
  };
}

function baseEntry(overrides: Partial<PlatformFeature> = {}): PlatformFeature {
  return {
    id: "test-entry",
    name: "Test Entry",
    roles: ["student"],
    summary: "A test entry.",
    ...overrides,
  };
}

describe("validatePlatformMap — real map", () => {
  it("returns no errors for the real PLATFORM_MAP against its own derived refs", () => {
    // Route/tool refs derived from the map itself (route-covered/tool-covered
    // will trivially pass); this isolates entry-shape rules (id-unique,
    // roles-nonempty, summary-nonempty, route-exists, tool-exists,
    // role-tool-consistency, compact-budget) against the real data.
    const errors = validatePlatformMap(PLATFORM_MAP, baseRefs());
    assert.deepEqual(errors, []);
  });

  it("validateRealPlatformMap also passes against real routes/tools (integration smoke)", () => {
    // Uses the same derived refs — full route/tool discovery is covered by
    // scripts/platform/validate.mjs (CLI), which is exercised separately.
    const errors = validateRealPlatformMap(baseRefs());
    assert.deepEqual(errors, []);
  });
});

describe("validatePlatformMap — rule violations", () => {
  it("flags id-unique for duplicate ids", () => {
    const entries = [baseEntry({ id: "dup" }), baseEntry({ id: "dup", name: "Other" })];
    const errors = validatePlatformMap(entries, baseRefs());
    assert.ok(errors.some((e) => e.rule === "id-unique"));
  });

  it("flags roles-nonempty for an entry with no roles", () => {
    const entries = [baseEntry({ roles: [] })];
    const errors = validatePlatformMap(entries, baseRefs());
    assert.ok(errors.some((e) => e.rule === "roles-nonempty"));
  });

  it("flags summary-nonempty for an entry with a blank summary", () => {
    const entries = [baseEntry({ summary: "   " })];
    const errors = validatePlatformMap(entries, baseRefs());
    assert.ok(errors.some((e) => e.rule === "summary-nonempty"));
  });

  it("flags route-exists for a route that doesn't resolve to a real page", () => {
    const entries = [baseEntry({ route: "/this-route-does-not-exist" })];
    const errors = validatePlatformMap(entries, baseRefs());
    assert.ok(errors.some((e) => e.rule === "route-exists"));
  });

  it("flags route-covered for a discovered route with no entry and not in ROUTE_IGNORE", () => {
    const refs = { ...baseRefs(), routePaths: [...baseRefs().routePaths, "/orphan-route"] };
    const errors = validatePlatformMap(PLATFORM_MAP, refs);
    assert.ok(errors.some((e) => e.rule === "route-covered" && e.id === "/orphan-route"));
  });

  it("flags tool-exists for a tool name not in the registry", () => {
    const entries = [baseEntry({ tools: ["not_a_real_tool"] })];
    const errors = validatePlatformMap(entries, baseRefs());
    assert.ok(errors.some((e) => e.rule === "tool-exists"));
  });

  it("flags tool-covered for a registered tool with no covering entry", () => {
    const refs: PlatformMapRefs = {
      routePaths: baseRefs().routePaths,
      toolNames: [...baseRefs().toolNames, "orphan_tool"],
      toolRoleMap: { ...baseRefs().toolRoleMap, orphan_tool: ["student"] },
    };
    const errors = validatePlatformMap(PLATFORM_MAP, refs);
    assert.ok(errors.some((e) => e.rule === "tool-covered" && e.id === "orphan_tool"));
  });

  it("flags role-tool-consistency when an entry's roles don't overlap the tool's requiredRoles", () => {
    const refs: PlatformMapRefs = {
      routePaths: baseRefs().routePaths,
      toolNames: [...baseRefs().toolNames, "admin_only_tool"],
      toolRoleMap: { ...baseRefs().toolRoleMap, admin_only_tool: ["admin"] },
    };
    const entries = [baseEntry({ roles: ["student"], tools: ["admin_only_tool"] })];
    const errors = validatePlatformMap(entries, refs);
    assert.ok(errors.some((e) => e.rule === "role-tool-consistency"));
  });

  it("flags compact-budget when a role's compact render exceeds the character limit", () => {
    const hugeCompact = "x".repeat(700);
    const entries = [baseEntry({ compact: hugeCompact })];
    const errors = validatePlatformMap(entries, baseRefs());
    assert.ok(errors.some((e) => e.rule === "compact-budget" && e.id === "student"));
  });
});
