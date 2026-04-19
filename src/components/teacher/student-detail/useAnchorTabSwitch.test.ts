import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveTabForAnchor } from "./useAnchorTabSwitch";

describe("resolveTabForAnchor", () => {
  const map = {
    "case-notes": "coach",
    "certification-review": "progress",
    "account-actions": "admin",
  } as const;

  it("returns the mapped tab for a known anchor", () => {
    assert.equal(resolveTabForAnchor("case-notes", map), "coach");
    assert.equal(resolveTabForAnchor("certification-review", map), "progress");
    assert.equal(resolveTabForAnchor("account-actions", map), "admin");
  });

  it("strips a leading hash from the input", () => {
    assert.equal(resolveTabForAnchor("#case-notes", map), "coach");
  });

  it("returns null for an unknown anchor", () => {
    assert.equal(resolveTabForAnchor("bogus", map), null);
  });

  it("returns null for an empty anchor", () => {
    assert.equal(resolveTabForAnchor("", map), null);
  });
});
