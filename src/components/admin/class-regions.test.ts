import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RELOAD_REGIONS_FAILED, fetchClassRegions, parseClassRegions } from "./class-regions";

function answer(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("reloading the class card's regions", () => {
  it("reads only the id and name of each region", () => {
    assert.deepEqual(parseClassRegions({ regions: [{ id: "r1", name: "North", code: "north" }], classes: [] }), [
      { id: "r1", name: "North" },
    ]);
  });

  it("refuses a reply that is not a list of regions", () => {
    assert.equal(parseClassRegions({ regions: [{ id: 3 }] }), null);
    assert.equal(parseClassRegions(null), null);
  });

  it("fetches the class list and returns its regions", async () => {
    assert.deepEqual(await fetchClassRegions(answer(200, { regions: [{ id: "r1", name: "North" }] })), [
      { id: "r1", name: "North" },
    ]);
  });

  it("fails with words a person can act on", async () => {
    await assert.rejects(fetchClassRegions(answer(500, { error: "boom" })), { message: RELOAD_REGIONS_FAILED });
  });
});
