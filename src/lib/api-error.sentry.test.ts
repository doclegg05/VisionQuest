import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { createSentryDouble, STUDENT_CUID, STUDENT_EMAIL, STUDENT_NAME } from "./sentry.test-support";

// H1 (2026-11-10): withErrorHandler logged an unexpected failure to the
// console and nothing else, so a 500 reached nobody. It must now send one
// event, scrubbed, naming the route pattern, method and status, and nothing
// for an expected failure.

const sentry = createSentryDouble();
mock.module("@sentry/nextjs", { namedExports: sentry.exports });

let apiError: typeof import("./api-error");

before(async () => {
  apiError = await import("./api-error");
});

const ROUTE_URL = `https://vq.example/api/teacher/students/${STUDENT_CUID}/goals?q=${encodeURIComponent(STUDENT_NAME)}`;

function postRequest(): Request {
  return new Request(ROUTE_URL, { method: "POST", body: JSON.stringify({ email: STUDENT_EMAIL }) });
}

function failingRoute(error: unknown) {
  return apiError.withErrorHandler(async (_req: Request) => {
    throw error;
  });
}

describe("withErrorHandler reports unexpected failures", () => {
  beforeEach(() => {
    sentry.reset();
    process.env.SENTRY_DSN = "https://public@o0.ingest.sentry.io/0";
  });
  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it("sends one event for a thrown route error", async () => {
    const res = await failingRoute(new Error(`lookup failed for ${STUDENT_EMAIL}`))(postRequest());
    assert.equal(res.status, 500);
    assert.equal(sentry.sent.length, 1);
  });

  it("names the route pattern, method and status", async () => {
    await failingRoute(new TypeError("boom"))(postRequest());
    const [event] = sentry.sent;
    assert.deepEqual(event?.tags, { route: "/api/teacher/students/[param]/goals", method: "POST", status: "500" });
    assert.equal(event?.transaction, "POST /api/teacher/students/[param]/goals");
  });

  it("carries no student id, name, email, body or query string", async () => {
    const prismaLike = Object.assign(new Error(`where: { displayName: "${STUDENT_NAME}", id: "${STUDENT_CUID}" }`), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    await failingRoute(prismaLike)(postRequest());
    const sent = JSON.stringify(sentry.sent);
    for (const identifier of [STUDENT_CUID, STUDENT_NAME, "Tanesha", STUDENT_EMAIL, "q="]) {
      assert.ok(!sent.includes(identifier), `event leaked ${identifier}: ${sent}`);
    }
    assert.equal(sentry.sent[0]?.request, undefined);
    assert.equal(sentry.sent[0]?.exception?.values?.[0]?.value, "[message withheld] code P2002");
  });

  for (const [label, error] of [
    ["a 400", () => apiError.badRequest("bad input")],
    ["a 401", () => apiError.unauthorized()],
    ["a 403", () => apiError.forbidden()],
    ["a 404", () => apiError.notFound()],
    ["a 429", () => apiError.rateLimited()],
  ] as const) {
    it(`sends nothing for ${label}`, async () => {
      await failingRoute(error())(postRequest());
      assert.equal(sentry.sent.length, 0);
    });
  }

  it("reports a thrown ApiError that is itself a 5xx", async () => {
    const res = await failingRoute(new apiError.ApiError(503, "Upstream down", "UPSTREAM"))(postRequest());
    assert.equal(res.status, 503);
    assert.equal(sentry.sent.length, 1);
    assert.equal(sentry.sent[0]?.tags?.status, "503");
  });
});

describe("withErrorHandler with no DSN", () => {
  it("sends nothing and still answers 500", async () => {
    sentry.reset();
    delete process.env.SENTRY_DSN;
    const res = await failingRoute(new Error("boom"))(postRequest());
    assert.equal(res.status, 500);
    assert.equal(sentry.sent.length, 0);
    assert.equal(sentry.scopes.length, 0);
  });
});
