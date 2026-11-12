import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { focusAfterRemove } from "./focus-after-remove";

function fakePage(present: readonly string[]) {
  const focused: string[] = [];
  const lookup = (id: string) => (present.includes(id) ? { focus: () => focused.push(id) } : null);
  return { focused, lookup, now: (run: () => void) => run() };
}

describe("focus after a coordinator is removed", () => {
  it("goes to the region's add-coordinator control", () => {
    const page = fakePage(["add-coordinator-r1", "region-r1"]);
    focusAfterRemove("r1", page.lookup, page.now);
    assert.deepEqual(page.focused, ["add-coordinator-r1"]);
  });

  it("goes to the region's row when there is no control", () => {
    const page = fakePage(["region-r1"]);
    focusAfterRemove("r1", page.lookup, page.now);
    assert.deepEqual(page.focused, ["region-r1"]);
  });
});
