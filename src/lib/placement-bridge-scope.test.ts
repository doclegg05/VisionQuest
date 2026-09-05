import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// "server-only" throws at import time outside a Next.js server build, and the
// two functions here are pure — same stub-then-dynamic-import shape as
// placement-bridge.test.ts.
mock.module("server-only", { namedExports: {} });

type PlacementBridgeScope = import("./placement-bridge").PlacementBridgeScope;

let mergePlacementBridgeScopes: typeof import("./placement-bridge").mergePlacementBridgeScopes;
let parsePlacementBridgeScope: typeof import("./placement-bridge").parsePlacementBridgeScope;

before(async () => {
  const mod = await import("./placement-bridge");
  mergePlacementBridgeScopes = mod.mergePlacementBridgeScopes;
  parsePlacementBridgeScope = mod.parsePlacementBridgeScope;
});

/**
 * Match & Connect Task 4.5: a class in the Connect pilot gets the placement
 * bridge too.
 *
 * Without this, a hire recorded through a Connection creates a verified
 * Application and then nothing happens — no "Record employment outcome" queue
 * item, no SPOKES prefill — because `placement_bridge_classes` was left unset.
 * Two flags for one workflow is a trap; the union is the fix.
 */
describe("mergePlacementBridgeScopes", () => {
  const off: PlacementBridgeScope = { mode: "off" };
  const all: PlacementBridgeScope = { mode: "all" };
  const alpha: PlacementBridgeScope = { mode: "classes", classIds: ["a"] };
  const beta: PlacementBridgeScope = { mode: "classes", classIds: ["b"] };

  it("off + off stays off", () => {
    assert.deepEqual(mergePlacementBridgeScopes(off, off), { mode: "off" });
  });

  it("all on either side wins", () => {
    assert.deepEqual(mergePlacementBridgeScopes(off, all), { mode: "all" });
    assert.deepEqual(mergePlacementBridgeScopes(all, alpha), { mode: "all" });
    assert.deepEqual(mergePlacementBridgeScopes(alpha, all), { mode: "all" });
  });

  it("unions the class lists without duplicating", () => {
    assert.deepEqual(mergePlacementBridgeScopes(alpha, beta), {
      mode: "classes",
      classIds: ["a", "b"],
    });
    assert.deepEqual(mergePlacementBridgeScopes(alpha, alpha), {
      mode: "classes",
      classIds: ["a"],
    });
  });

  it("keeps whichever side has classes when the other is off", () => {
    assert.deepEqual(mergePlacementBridgeScopes(off, beta), { mode: "classes", classIds: ["b"] });
    assert.deepEqual(mergePlacementBridgeScopes(alpha, off), { mode: "classes", classIds: ["a"] });
  });

  it("composes with the parser both flags use", () => {
    assert.deepEqual(
      mergePlacementBridgeScopes(
        parsePlacementBridgeScope("class-1"),
        parsePlacementBridgeScope("class-2, class-1"),
      ),
      { mode: "classes", classIds: ["class-1", "class-2"] },
    );
  });
});
