/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

const mockItemFindMany = mock.fn(async () => [
  { id: "item-done", label: "Done step", required: true },
  { id: "item-pending", label: "Pending step", required: true },
  { id: "item-open", label: "Open step", required: false },
]) as any;
const mockProgressFindMany = mock.fn(async () => [
  { itemId: "item-done", completed: true, verificationStatus: null },
  { itemId: "item-pending", completed: false, verificationStatus: "pending" },
]) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      orientationItem: { findMany: mockItemFindMany },
      orientationProgress: { findMany: mockProgressFindMany },
    },
  },
});

let loadOpenOrientationItems: typeof import("./open-orientation-items").loadOpenOrientationItems;

before(async () => {
  ({ loadOpenOrientationItems } = await import("./open-orientation-items"));
});

describe("loadOpenOrientationItems", () => {
  it("returns only the items this student can still file a signed form against", async () => {
    const open = await loadOpenOrientationItems("stu-1");
    assert.deepEqual(open, [{ id: "item-open", label: "Open step" }]);
  });

  it("scopes progress to the student and reads the verification state the filter needs", async () => {
    await loadOpenOrientationItems("stu-1");
    const args = mockProgressFindMany.mock.calls.at(-1).arguments[0];
    assert.deepEqual(args.where, { studentId: "stu-1" });
    assert.equal(args.select.verificationStatus, true);
  });
});
