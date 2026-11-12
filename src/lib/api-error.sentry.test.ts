import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import * as apiError from "./api-error";
import { insideRequest, type Outbox, PLANTED, PLANTED_REQUEST, plantedIn, settleSdk, startServerSdk, TEST_DSN } from "./sentry.test-support";

// H1 (2026-11-10): withErrorHandler logged an unexpected failure to the
// console and nothing else, so a 500 reached nobody. It now sends one event
// naming the route pattern, method and status, and nothing for an expected
// failure.
//
// These run the real SDK with the app's server options, inside a real HTTP
// request whose path, query string, cookie, referer and body all carry
// planted student data (src/lib/sentry.test-support.ts). What is asserted on
// is the envelope the SDK handed to its transport.

let outbox: Outbox;
mock.method(console, "error", () => {});

before(() => {
  outbox = startServerSdk();
});

/** Runs a route that throws `error` inside the planted request; resolves to its status. */
async function failingRoute(error: unknown): Promise<number> {
  const route = apiError.withErrorHandler(async (_req: Request) => {
    throw error;
  });
  let status = 0;
  await insideRequest(async (request) => {
    status = (await route(request)).status;
  });
  await settleSdk();
  return status;
}

describe("withErrorHandler reports unexpected failures", () => {
  beforeEach(() => {
    outbox.clear();
    process.env.SENTRY_DSN = TEST_DSN;
  });
  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it("sends one event for a thrown route error, and nothing else", async () => {
    assert.equal(await failingRoute(new Error(`lookup failed for ${PLANTED.email}`)), 500);
    assert.deepEqual(outbox.itemTypes(), ["event"]);
  });

  it("names the route pattern, method and status", async () => {
    await failingRoute(new TypeError("boom"));
    const [event] = outbox.events();
    assert.deepEqual(event?.tags, { route: PLANTED_REQUEST.routePattern, method: "POST", status: "500" });
    assert.equal(event?.transaction, `POST ${PLANTED_REQUEST.routePattern}`);
    assert.equal(event?.exception?.values?.[0]?.type, "TypeError");
  });

  it("puts no student data on the wire: no id, name, email, body, cookie or query string", async () => {
    const prismaLike = Object.assign(new Error(`where: { displayName: "${PLANTED.name}", id: "${PLANTED.recordId}" }`), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    await failingRoute(prismaLike);
    assert.deepEqual(plantedIn(outbox.envelopes), []);
    const [event] = outbox.events();
    assert.equal(event?.request, undefined);
    assert.equal(event?.breadcrumbs, undefined);
    assert.equal(event?.exception?.values?.[0]?.value, "[message withheld] code P2002");
  });

  it("carries only the allowlisted fields", async () => {
    await failingRoute(new Error("boom"));
    const [event] = outbox.events();
    // `release` and `dist` are allowlisted labels the SDK fills in only when the
    // environment names a release (GITHUB_SHA in CI, RENDER_GIT_COMMIT on Render).
    const ENV_LABELS = new Set(["release", "dist"]);
    assert.deepEqual(Object.keys(event ?? {}).filter((key) => !ENV_LABELS.has(key)).sort(), [
      "contexts",
      "environment",
      "event_id",
      "exception",
      "level",
      "platform",
      "sdk",
      "tags",
      "timestamp",
      "transaction",
      "type",
    ]);
    assert.deepEqual(Object.keys(event?.contexts ?? {}).sort(), ["runtime", "trace"]);
  });

  for (const [label, error] of [
    ["a 400", () => apiError.badRequest("bad input")],
    ["a 401", () => apiError.unauthorized()],
    ["a 403", () => apiError.forbidden()],
    ["a 404", () => apiError.notFound()],
    ["a 429", () => apiError.rateLimited()],
  ] as const) {
    it(`sends nothing for ${label}`, async () => {
      await failingRoute(error());
      assert.deepEqual(outbox.itemTypes(), []);
    });
  }

  it("reports a thrown ApiError that is itself a 5xx", async () => {
    assert.equal(await failingRoute(new apiError.ApiError(503, "Upstream down", "UPSTREAM")), 503);
    assert.equal(outbox.events()[0]?.tags?.status, "503");
  });
});

describe("withErrorHandler with no DSN", () => {
  it("sends nothing and still answers 500", async () => {
    outbox.clear();
    delete process.env.SENTRY_DSN;
    assert.equal(await failingRoute(new Error("boom")), 500);
    assert.deepEqual(outbox.itemTypes(), []);
  });
});
