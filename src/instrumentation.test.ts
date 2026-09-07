/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding stands in for functions with several different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// ---------------------------------------------------------------------------
// Wiring proof for the boot probes (2026-09-06 hunt, follow-up 4).
//
// A probe module nobody calls is the same silence it was written to end, so
// the call site is pinned here rather than left to a reader of register().
// ---------------------------------------------------------------------------

const runBootProbes = mock.fn(async () => {}) as any;
const validateRuntimeEnv = mock.fn(() => {}) as any;

mock.module("@/lib/boot-probes", { namedExports: { runBootProbes } });
mock.module("@/lib/env", { namedExports: { validateRuntimeEnv } });
mock.module("@/lib/logger", {
  namedExports: { logger: { debug: mock.fn(), info: mock.fn(), warn: mock.fn(), error: mock.fn() } },
});
mock.module("../sentry.server.config", { namedExports: {} });
mock.module("../sentry.edge.config", { namedExports: {} });

let instrumentation: Awaited<typeof import("./instrumentation")>;

before(async () => {
  instrumentation = await import("./instrumentation");
});

describe("register()", () => {
  beforeEach(() => {
    runBootProbes.mock.resetCalls();
    validateRuntimeEnv.mock.resetCalls();
    runBootProbes.mock.mockImplementation(async () => {});
    validateRuntimeEnv.mock.mockImplementation(() => {});
  });

  it("runs the boot probes on the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await instrumentation.register();
    assert.equal(runBootProbes.mock.callCount(), 1);
  });

  it("does not run them on the edge runtime, which has no database client", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await instrumentation.register();
    assert.equal(runBootProbes.mock.callCount(), 0);
  });

  it("propagates a probe failure so the boot stops", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    runBootProbes.mock.mockImplementation(async () => {
      throw new Error("Boot probe failure (1): RLS_CONTEXT_INJECTION — …");
    });

    await assert.rejects(() => instrumentation.register(), /Boot probe failure/);
  });

  it("runs them only after the environment itself validates", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    validateRuntimeEnv.mock.mockImplementation(() => {
      throw new Error("Missing required environment variable: DATABASE_URL");
    });

    await assert.rejects(() => instrumentation.register(), /DATABASE_URL/);
    assert.equal(runBootProbes.mock.callCount(), 0, "a malformed environment fails before the probes run");
  });
});
