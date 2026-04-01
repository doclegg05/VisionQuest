import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractProviderQuotaSnapshots } from "./limits";

describe("extractProviderQuotaSnapshots", () => {
  it("parses RapidAPI quota headers into provider windows", () => {
    const headers = new Headers({
      "x-ratelimit-requests-limit": "500",
      "x-ratelimit-requests-remaining": "123",
      "x-ratelimit-requests-reset": "1711999999",
      "x-ratelimit-limit": "5",
      "x-ratelimit-remaining": "2",
      "x-ratelimit-reset": "1711000000",
    });

    const snapshots = extractProviderQuotaSnapshots("jsearch", headers);

    assert.equal(snapshots.length, 2);
    assert.deepEqual(
      snapshots.map((snapshot) => snapshot.id),
      ["requests", "burst"],
    );
    assert.equal(snapshots[0]?.limit, 500);
    assert.equal(snapshots[0]?.remaining, 123);
    assert.equal(snapshots[0]?.resetTime, 1711999999 * 1000);
  });

  it("returns an empty list when provider headers are missing", () => {
    const snapshots = extractProviderQuotaSnapshots("adzuna", new Headers());
    assert.deepEqual(snapshots, []);
  });
});
