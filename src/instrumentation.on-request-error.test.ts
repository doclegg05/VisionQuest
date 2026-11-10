import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { createSentryDouble, STUDENT_CUID, STUDENT_NAME } from "./lib/sentry.test-support";

// H1 (2026-11-10): src/instrumentation.ts exported only `register`, so an
// error Next caught while rendering a page or running an unwrapped route
// handler never left the host's log stream. `onRequestError` now reports it
// through the SDK's request-error capture, without the request path's ids,
// the query string or the headers.

const sentry = createSentryDouble();
mock.module("@sentry/nextjs", { namedExports: sentry.exports });
const runBootProbes = mock.fn(async (): Promise<void> => {});
mock.module("@/lib/boot-probes", { namedExports: { runBootProbes } });
mock.module("@/lib/env", { namedExports: { validateRuntimeEnv: () => {} } });
mock.module("../sentry.server.config", { namedExports: {} });
mock.module("../sentry.edge.config", { namedExports: {} });

let instrumentation: typeof import("./instrumentation");

before(async () => {
  instrumentation = await import("./instrumentation");
});

const request = {
  path: `/teacher/students/${STUDENT_CUID}?tab=${encodeURIComponent(STUDENT_NAME)}`,
  method: "GET",
  headers: { cookie: "vq_session=abc", referer: `https://vq.example/teacher/students/${STUDENT_CUID}` },
};
const context = {
  routerKind: "App Router",
  routePath: "/teacher/students/[id]",
  routeType: "render",
  revalidateReason: undefined,
} as const;

describe("onRequestError", () => {
  beforeEach(() => {
    sentry.reset();
    process.env.SENTRY_DSN = "https://public@o0.ingest.sentry.io/0";
  });
  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it("is exported", () => {
    assert.equal(typeof instrumentation.onRequestError, "function");
  });

  it("sends one event naming the route pattern and method", async () => {
    await instrumentation.onRequestError(new Error("render failed"), request, context);
    assert.equal(sentry.sent.length, 1);
    assert.equal(sentry.sent[0]?.tags?.route, "/teacher/students/[id]");
    assert.equal(sentry.sent[0]?.tags?.method, "GET");
  });

  it("passes the SDK the route pattern, not the real path or headers", async () => {
    await instrumentation.onRequestError(new Error(`no student ${STUDENT_CUID}`), request, context);
    const sent = JSON.stringify(sentry.sent);
    for (const identifier of [STUDENT_CUID, "Tanesha", "tab=", "vq_session"]) {
      assert.ok(!sent.includes(identifier), `event leaked ${identifier}: ${sent}`);
    }
  });

  it("sends nothing with no DSN", async () => {
    delete process.env.SENTRY_DSN;
    await instrumentation.onRequestError(new Error("render failed"), request, context);
    assert.equal(sentry.sent.length, 0);
    assert.equal(sentry.scopes.length, 0);
  });
});

describe("register() reports a production boot-probe failure", () => {
  beforeEach(() => {
    sentry.reset();
    process.env.NEXT_RUNTIME = "nodejs";
    runBootProbes.mock.mockImplementation(async () => {
      throw new Error("Boot probe failure (1): RLS_CONTEXT_INJECTION is not on");
    });
  });
  afterEach(() => {
    delete process.env.SENTRY_DSN;
    runBootProbes.mock.mockImplementation(async () => {});
  });

  it("sends the failure before the boot stops", async () => {
    process.env.SENTRY_DSN = "https://public@o0.ingest.sentry.io/0";
    await assert.rejects(() => instrumentation.register(), /Boot probe failure/);
    assert.equal(sentry.sent.length, 1);
  });

  it("sends nothing with no DSN, and still stops the boot", async () => {
    await assert.rejects(() => instrumentation.register(), /Boot probe failure/);
    assert.equal(sentry.sent.length, 0);
  });
});
