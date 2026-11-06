import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { placeApplicant } from "./PlaceApplicantControl";

function deps(overrides: { post?: (url: string, body: unknown) => Promise<unknown> } = {}) {
  const calls: string[] = [];
  return {
    calls,
    args: {
      applicantId: "s1",
      classId: "c1",
      post: overrides.post ?? (async () => {
        calls.push("post");
      }),
      onPlaced: () => calls.push("onPlaced"),
      refresh: () => calls.push("refresh"),
    },
  };
}

describe("placeApplicant", () => {
  it("removes the row locally and refreshes server-rendered counts after a successful placement", async () => {
    const { calls, args } = deps();
    await placeApplicant(args);
    assert.deepEqual(calls, ["post", "onPlaced", "refresh"]);
  });

  it("neither removes the row nor refreshes when the placement fails", async () => {
    const { calls, args } = deps({
      post: async () => {
        throw new Error("nope");
      },
    });
    await assert.rejects(placeApplicant(args), /nope/);
    assert.deepEqual(calls, []);
  });
});
