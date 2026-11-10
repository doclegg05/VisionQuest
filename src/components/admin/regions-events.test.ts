import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REGIONS_CHANGED_EVENT, announceRegionsChanged, onRegionsChanged } from "./regions-events";

describe("the regions-changed signal", () => {
  it("uses one named event, so every card listens for the same thing", () => {
    assert.equal(REGIONS_CHANGED_EVENT, "vq:regions-changed");
  });

  it("reaches a card that listens", () => {
    const target = new EventTarget();
    let heard = 0;
    onRegionsChanged(target, () => {
      heard += 1;
    });
    announceRegionsChanged(target);
    announceRegionsChanged(target);
    assert.equal(heard, 2);
  });

  it("stops reaching a card once it stops listening", () => {
    const target = new EventTarget();
    let heard = 0;
    const stop = onRegionsChanged(target, () => {
      heard += 1;
    });
    stop();
    announceRegionsChanged(target);
    assert.equal(heard, 0);
  });
});
