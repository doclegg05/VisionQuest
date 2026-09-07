import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { getRlsContext, withRlsContext } from "./rls-context";

// Pinning four things about `deferAfterResponse`:
//  1. Inside a request scope it hands the effect to Next's `after()` and does
//     NOT run it inline — the response must not wait on it.
//  2. Outside a request scope (`after()` throws) the effect still runs, so a
//     route test that calls the handler directly can observe the side effect.
//  3. The effect keeps the caller's RLS context even when Next invokes it
//     later, from outside the `withRlsContext` scope — the Prisma extension
//     reads that context on every query, so losing it would run the deferred
//     alert sync as nobody (fail-closed under vq_app: silent zero rows).
//  4. An effect that rejects is logged, never an unhandled rejection.

const mockAfter = mock.fn<(task: () => Promise<void>) => void>();
const mockLogError = mock.fn<(message: string, context?: Record<string, unknown>) => void>();

mock.module("next/server", {
  namedExports: {
    after: mockAfter,
  },
});

mock.module("./logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: mockLogError,
    },
  },
});

// Late import — must come after the mock.module calls.
let deferAfterResponse: typeof import("./after-response").deferAfterResponse;

const ACTOR = { userId: "student-a", role: "student", studentId: "student-a" };

describe("deferAfterResponse", () => {
  before(async () => {
    ({ deferAfterResponse } = await import("./after-response"));
  });

  beforeEach(() => {
    mockAfter.mock.resetCalls();
    mockLogError.mock.resetCalls();
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

  it("keeps the caller's RLS context when after() runs the task outside the scope", async () => {
    let seen: ReturnType<typeof getRlsContext> = undefined;
    mockAfter.mock.mockImplementation(() => undefined);

    withRlsContext(ACTOR, () => {
      deferAfterResponse(async () => {
        seen = getRlsContext();
      });
    });

    // Invoked from here, where no RLS context is active — as Next does once
    // the response has been sent.
    assert.equal(getRlsContext(), undefined, "precondition: the test itself has no context");
    await mockAfter.mock.calls[0].arguments[0]();
    assert.deepEqual(seen, ACTOR, "the deferred effect lost the actor it was scheduled under");
  });

  it("runs the effect immediately, with its context, when there is no request scope", async () => {
    let seen: ReturnType<typeof getRlsContext> | "not run" = "not run";
    mockAfter.mock.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });

    withRlsContext(ACTOR, () => {
      deferAfterResponse(async () => {
        seen = getRlsContext();
      });
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, ACTOR, "with no request scope the effect must still happen, as the actor");
  });

  it("logs a rejecting effect instead of surfacing an unhandled rejection", async () => {
    mockAfter.mock.mockImplementation(() => {
      throw new Error("no scope");
    });

    deferAfterResponse(async () => {
      throw new Error("sync blew up for someone@example.com");
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(mockLogError.mock.callCount(), 1);
    const payload = mockLogError.mock.calls[0].arguments[1] ?? {};
    assert.ok(String(payload.error).includes("sync blew up"));
    assert.ok(!String(payload.error).includes("someone@example.com"), "contact info is redacted from the log line");
  });

  it("never throws to the caller, on either path", () => {
    mockAfter.mock.mockImplementation(() => {
      throw new Error("no scope");
    });
    assert.doesNotThrow(() => deferAfterResponse(async () => undefined));
  });
});
