import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Pinning two things about `deferAfterResponse`:
//  1. Inside a request scope it hands the effect to Next's `after()` and does
//     NOT run it inline — the response must not wait on it.
//  2. Outside a request scope (`after()` throws) the effect still runs, so a
//     route test that calls the handler directly can observe the side effect.

const mockAfter = mock.fn<(task: () => Promise<void>) => void>();

mock.module("next/server", {
  namedExports: {
    after: mockAfter,
  },
});

// Late import — must come after the mock.module call.
let deferAfterResponse: typeof import("./after-response").deferAfterResponse;

describe("deferAfterResponse", () => {
  before(async () => {
    ({ deferAfterResponse } = await import("./after-response"));
  });

  beforeEach(() => {
    mockAfter.mock.resetCalls();
  });

  it("schedules the effect through after() and does not run it inline", async () => {
    let ran = false;
    mockAfter.mock.mockImplementation(() => undefined);

    deferAfterResponse(async () => {
      ran = true;
    });

    assert.equal(mockAfter.mock.callCount(), 1);
    assert.equal(ran, false, "the effect must wait for after(), not run before the response");

    // Next runs the task once the response is done; simulate that.
    await mockAfter.mock.calls[0].arguments[0]();
    assert.equal(ran, true);
  });

  it("runs the effect immediately when there is no request scope", async () => {
    let ran = false;
    mockAfter.mock.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });

    deferAfterResponse(async () => {
      ran = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ran, true, "with no request scope the effect must still happen");
  });

  it("never throws to the caller, on either path", () => {
    mockAfter.mock.mockImplementation(() => {
      throw new Error("no scope");
    });
    assert.doesNotThrow(() => deferAfterResponse(async () => undefined));
  });
});
