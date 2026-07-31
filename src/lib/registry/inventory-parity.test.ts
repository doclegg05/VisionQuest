// =============================================================================
// VQ-R-026 — the endpoint registry may never drift from the route tree again.
//
// The 2,217-line hand-written registry was 92% unenforced and two months
// stale. Per the locked owner decision, the route INVENTORY is now generated
// from src/app/api (config/endpoint-inventory.generated.json, regenerated via
// `npm run registry:generate`) and this test — modeled on the catalog
// overlay-freshness guardrail — fails CI whenever:
//   1. the committed inventory no longer matches the tree (drift),
//   2. a route wires a withRegistry id that the registry doesn't define, or
//   3. a registry entry points at a path/method that no longer exists.
// Hand-authored metadata (descriptions, roles, audit levels) stays in
// tools.ts — it can't be derived statically; only its CORRESPONDENCE to the
// tree is enforced here.
// =============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain .mjs helper shared with the generator script
import { walkRouteInventory } from "../../../scripts/lib/endpoint-inventory.mjs";
import { TOOLS } from "./tools";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const API_ROOT = path.join(ROOT, "src", "app", "api");
const INVENTORY_PATH = path.join(ROOT, "config", "endpoint-inventory.generated.json");

interface InventoryRoute {
  path: string;
  methods: string[];
  registryIds: string[];
}

function loadCommitted(): { routes: InventoryRoute[] } {
  return JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
}

describe("endpoint inventory parity (VQ-R-026)", () => {
  it("the committed inventory matches the live route tree — run `npm run registry:generate` on drift", () => {
    const live = walkRouteInventory(API_ROOT) as InventoryRoute[];
    const committed = loadCommitted().routes;
    assert.deepEqual(
      committed,
      live,
      "config/endpoint-inventory.generated.json is stale — run `npm run registry:generate` and commit the result",
    );
  });

  it("every withRegistry id used by a route exists in the registry", () => {
    const known = new Set(TOOLS.map((t) => t.id));
    for (const route of loadCommitted().routes) {
      for (const id of route.registryIds) {
        assert.ok(known.has(id), `${route.path} wires unknown registry id "${id}"`);
      }
    }
  });

  it("every enabled registry endpoint points at a real route and method", () => {
    const byPath = new Map(loadCommitted().routes.map((r) => [r.path, r]));
    for (const tool of TOOLS) {
      if (!tool.enabled || !tool.endpoint) continue;
      const route = byPath.get(tool.endpoint.path);
      assert.ok(route, `registry entry "${tool.id}" points at missing route ${tool.endpoint.path}`);
      assert.ok(
        route.methods.includes(tool.endpoint.method),
        `registry entry "${tool.id}" claims ${tool.endpoint.method} ${tool.endpoint.path}, but the route exports [${route.methods.join(", ")}]`,
      );
    }
  });

  it("registry ids are unique", () => {
    const seen = new Set<string>();
    for (const tool of TOOLS) {
      assert.ok(!seen.has(tool.id), `duplicate registry id "${tool.id}"`);
      seen.add(tool.id);
    }
  });
});
