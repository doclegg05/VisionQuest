import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runSaveAndDescribeError } from "./JobCard";
import { SaveJobError } from "@/lib/job-board/save-error";

/**
 * VQ-R-016: `JobCard`'s Save/Update button used to call `onSave` and ignore
 * whatever happened next — no error, no toast, the button just went back to
 * normal. `runSaveAndDescribeError` is the pure decision this component
 * makes about what (if anything) to show the student; it is exported so the
 * mapping is testable without a DOM (this repo's `.test.tsx` files only
 * exercise `renderToString`, which cannot simulate a click or an async
 * state update — see the builder's report for why this is the unit under
 * test instead of a full render-and-click).
 */
describe("runSaveAndDescribeError (VQ-R-016)", () => {
  it("returns null when onSave resolves", async () => {
    const message = await runSaveAndDescribeError(async () => {}, "job-1", { status: "saved" });
    assert.equal(message, null);
  });

  it("returns null when there is no onSave handler at all", async () => {
    const message = await runSaveAndDescribeError(undefined, "job-1", { status: "saved" });
    assert.equal(message, null);
  });

  it("surfaces the SaveJobError message when onSave throws one", async () => {
    const message = await runSaveAndDescribeError(
      async () => {
        throw new SaveJobError(
          "This job isn't on your class's board yet. Try a different job below, or ask your teacher.",
          "not_your_class_board",
        );
      },
      "job-1",
      { status: "saved" },
    );
    assert.equal(message, "This job isn't on your class's board yet. Try a different job below, or ask your teacher.");
  });

  it("falls back to a generic message when onSave throws something else", async () => {
    const message = await runSaveAndDescribeError(
      async () => {
        throw new Error("network exploded");
      },
      "job-1",
      { status: "saved" },
    );
    assert.equal(message, "We couldn't save that job. Try again.");
  });

  it("passes the job id and update through to onSave unchanged", async () => {
    let seen: [string, unknown] | null = null;
    await runSaveAndDescribeError(
      async (id, update) => {
        seen = [id, update];
      },
      "job-42",
      { status: "applied", notes: "called them" },
    );
    assert.deepEqual(seen, ["job-42", { status: "applied", notes: "called them" }]);
  });
});
