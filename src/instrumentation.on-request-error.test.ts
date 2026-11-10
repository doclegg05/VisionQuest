import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { type Outbox, PLANTED, plantedIn, settleSdk, startServerSdk, TEST_DSN } from "./lib/sentry.test-support";

// H1 (2026-11-10): src/instrumentation.ts exported only `register`, so an
// error Next caught while rendering a page or running an unwrapped route
// handler never left the host's log stream. `onRequestError` now reports it
// through the SDK's request-error capture, without the request path's ids,
// the query string or the headers.
//
// These run the real SDK with the app's server options and assert on what it
// handed to its transport (src/lib/sentry.test-support.ts).

const runBootProbes = mock.fn(async (): Promise<void> => {});
mock.module("@/lib/boot-probes", { namedExports: { runBootProbes } });
mock.module("@/lib/env", { namedExports: { validateRuntimeEnv: () => {} } });
// `register` imports these to start the SDK. The harness has started it
// already, with the same options and a recording transport.
mock.module("../sentry.server.config", { namedExports: {} });
mock.module("../sentry.edge.config", { namedExports: {} });
mock.method(console, "error", () => {});

let instrumentation: typeof import("./instrumentation");
let outbox: Outbox;

before(async () => {
  outbox = startServerSdk();
  instrumentation = await import("./instrumentation");
});

const request = {
  path: `/teacher/students/${PLANTED.recordId}?tab=${encodeURIComponent(PLANTED.name)}`,
  method: "GET",
  headers: { cookie: `vq-session=${PLANTED.password}`, referer: `https://vq.example/credentials/${PLANTED.slug}` },
};
const context = {
  routerKind: "App Router",
  routePath: "/teacher/students/[id]",
  routeType: "render",
  revalidateReason: undefined,
} as const;

describe("onRequestError", () => {
  beforeEach(() => {
    outbox.clear();
    process.env.SENTRY_DSN = TEST_DSN;
  });
  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it("sends one event naming the route pattern and method", async () => {
    await instrumentation.onRequestError(new Error("render failed"), request, context);
    await settleSdk();
    assert.deepEqual(outbox.itemTypes(), ["event"]);
    assert.deepEqual(outbox.events()[0]?.tags, { route: "/teacher/students/[id]", method: "GET" });
  });

  it("puts nothing from the real path, the headers or the message on the wire", async () => {
    await instrumentation.onRequestError(new Error(`no student ${PLANTED.recordId} (${PLANTED.name})`), request, context);
    await settleSdk();
    assert.deepEqual(plantedIn(outbox.envelopes), []);
    assert.equal(outbox.events()[0]?.exception?.values?.[0]?.value, "[message withheld]");
  });

  it("sends nothing with no DSN", async () => {
    delete process.env.SENTRY_DSN;
    await instrumentation.onRequestError(new Error("render failed"), request, context);
    await settleSdk();
    assert.deepEqual(outbox.itemTypes(), []);
  });
});

describe("register() reports a production boot-probe failure", () => {
  /**
   * A database that cannot be reached, as Prisma reports one. A new error
   * each time: the SDK does not capture the same error object twice.
   */
  function unreachable(): Error {
    return Object.assign(new Error(`Boot probe failure (1): cannot reach db.internal as ${PLANTED.loginId}`), {
      name: "PrismaClientInitializationError",
      errorCode: "P1001",
    });
  }

  beforeEach(() => {
    outbox.clear();
    process.env.NEXT_RUNTIME = "nodejs";
    runBootProbes.mock.mockImplementation(async () => {
      throw unreachable();
    });
  });
  afterEach(() => {
    delete process.env.SENTRY_DSN;
    runBootProbes.mock.mockImplementation(async () => {});
  });

  it("sends the failure before the boot stops, as the alarm it is", async () => {
    process.env.SENTRY_DSN = TEST_DSN;
    await assert.rejects(() => instrumentation.register(), /Boot probe failure/);
    assert.deepEqual(outbox.itemTypes(), ["event"]);
    assert.deepEqual(outbox.events()[0]?.tags, { alert: "boot_probe_failed" });
  });

  it("gives it the same treatment as the other paths: the type and the error code, not the message", async () => {
    process.env.SENTRY_DSN = TEST_DSN;
    await assert.rejects(() => instrumentation.register(), /Boot probe failure/);
    const [entry] = outbox.events()[0]?.exception?.values ?? [];
    assert.equal(entry?.type, "PrismaClientInitializationError");
    assert.equal(entry?.value, "[message withheld] code P1001");
    assert.deepEqual(plantedIn(outbox.envelopes), []);
  });

  it("sends nothing with no DSN, and still stops the boot", async () => {
    await assert.rejects(() => instrumentation.register(), /Boot probe failure/);
    assert.deepEqual(outbox.itemTypes(), []);
  });
});
