/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to several real function signatures; test setup only. */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// Review F19 / SEC-09 (2026-09-01): /api/csp-report is reachable by anyone
// with no session. Before this change it had no rate limit, no body cap, and
// logged attacker-chosen strings verbatim, including a document-uri that can
// carry /reset-password?token=... into the log store.

const mockRateLimit = mock.fn() as any;
const mockLoggerWarn = mock.fn() as any;

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit: mockRateLimit, rateLimitDaily: mock.fn() },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: mockLoggerWarn, error: mock.fn() },
    requestId: () => "rid",
  },
});
mock.module("@/lib/db", { namedExports: { prismaAdmin: {}, prisma: {} } });
mock.module("@/lib/auth", { namedExports: { getSession: async () => null } });

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

const CLIENT_IP = "203.0.113.9";
const ADMITTED = { success: true, remaining: 9, resetTime: 0, degraded: false };
const REFUSED = { success: false, remaining: 0, resetTime: 0, degraded: false };
const SECRET = "tok_LIVE_RESET_9f8e7d6c";

const hostileV1Report = {
  "csp-report": {
    "document-uri": `https://vq.example/reset-password?token=${SECRET}#frag`,
    "blocked-uri": `https://evil.example/x.js?exfil=${SECRET}`,
    "violated-directive": "script-src 'self'",
    "source-file": `https://evil.example/src.js?leak=${SECRET}`,
    "script-sample": `ATTACKER-CHOSEN ${"x".repeat(500)}`,
    "original-policy": "default-src 'self'; script-src 'self'",
    "line-number": 42,
  },
};

function post(body: unknown) {
  const req = mockRequest("/api/csp-report", {
    method: "POST",
    body,
    headers: { "x-forwarded-for": `${CLIENT_IP}, 10.0.0.1` },
  });
  return route.POST(req as never);
}

function loggedMeta(): Record<string, unknown> {
  assert.equal(mockLoggerWarn.mock.callCount(), 1, "expected exactly one CSP violation log line");
  const [message, meta] = mockLoggerWarn.mock.calls[0].arguments as [string, Record<string, unknown>];
  assert.equal(message, "CSP violation");
  return meta;
}

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    mockRateLimit.mock.resetCalls();
    mockLoggerWarn.mock.resetCalls();
    mockRateLimit.mock.mockImplementation(async () => ADMITTED);
  });

  it("rate-limits per client IP through the shared limiter and logs nothing when refused", async () => {
    mockRateLimit.mock.mockImplementation(async () => REFUSED);
    const res = await post(hostileV1Report);
    assert.equal(res.status, 429);
    assert.equal(mockRateLimit.mock.callCount(), 1);
    const [key] = mockRateLimit.mock.calls[0].arguments as [string];
    assert.equal(key, `csp-report:${CLIENT_IP}`);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  it("rejects a body over 16 KB with 413 and logs nothing", async () => {
    const res = await post({ "csp-report": { "violated-directive": "x".repeat(20_000) } });
    assert.equal(res.status, 413);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  it("logs only the fixed fields, derived from the report, never the raw strings", async () => {
    const res = await post(hostileV1Report);
    assert.equal(res.status, 204);
    const meta = loggedMeta();
    assert.deepEqual(Object.keys(meta).sort(), ["blockedHost", "documentPath", "violatedDirective"]);
    assert.equal(meta.violatedDirective, "script-src 'self'");
    assert.equal(meta.blockedHost, "evil.example");
    assert.equal(meta.documentPath, "/reset-password");
    const text = JSON.stringify(meta);
    assert.doesNotMatch(text, new RegExp(SECRET));
    assert.doesNotMatch(text, /ATTACKER-CHOSEN|script-sample|source-file|original-policy/);
  });

  it("truncates every logged field to a fixed length", async () => {
    await post({
      "csp-report": {
        "violated-directive": `script-src ${"y".repeat(1000)}`,
        "blocked-uri": `https://${"h".repeat(1000)}.example/`,
        "document-uri": `https://vq.example/${"p".repeat(1000)}`,
      },
    });
    const meta = loggedMeta();
    for (const [key, value] of Object.entries(meta)) {
      assert.ok(typeof value === "string" && value.length <= 120, `${key} is ${String(value).length} chars`);
    }
  });

  it("keeps a non-URL blocked-uri keyword such as inline as the literal token", async () => {
    await post({
      "csp-report": { "violated-directive": "script-src", "blocked-uri": "inline", "document-uri": "https://vq.example/home" },
    });
    assert.equal(loggedMeta().blockedHost, "inline");
  });

  it("accepts the Reporting API v2 array shape", async () => {
    await post([
      {
        type: "csp-violation",
        age: 12,
        body: {
          documentURL: `https://vq.example/settings?token=${SECRET}`,
          blockedURL: "https://cdn.evil.example/a.js",
          effectiveDirective: "img-src",
        },
      },
    ]);
    const meta = loggedMeta();
    assert.equal(meta.documentPath, "/settings");
    assert.equal(meta.blockedHost, "cdn.evil.example");
    assert.equal(meta.violatedDirective, "img-src");
  });

  it("ignores malformed JSON with 204 and no log line", async () => {
    const req = new Request("http://localhost:3000/api/csp-report", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report", "x-forwarded-for": CLIENT_IP },
      body: "{not json",
    });
    const res = await route.POST(req as never);
    assert.equal(res.status, 204);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  it("ignores a report with no directive with 204 and no log line", async () => {
    const res = await post({ hello: "world" });
    assert.equal(res.status, 204);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });
});

// The detector must stay on wherever it is not explicitly silenced. It was
// briefly gated on `NODE_ENV !== "production"`, which turned it off in CI —
// the run that is supposed to catch a CSP regression on a new public page.
describe("POST /api/csp-report — CSP_REPORT_SILENCE", () => {
  const setEnv = (key: string, value: string | undefined) => {
    if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
    else (process.env as Record<string, string | undefined>)[key] = value;
  };

  let priorSilence: string | undefined;
  let priorNodeEnv: string | undefined;

  beforeEach(() => {
    priorSilence = process.env.CSP_REPORT_SILENCE;
    priorNodeEnv = process.env.NODE_ENV;
    mockRateLimit.mock.resetCalls();
    mockLoggerWarn.mock.resetCalls();
    mockRateLimit.mock.mockImplementation(async () => ADMITTED);
  });

  afterEach(() => {
    setEnv("CSP_REPORT_SILENCE", priorSilence);
    setEnv("NODE_ENV", priorNodeEnv);
  });

  it("stays on outside production when the variable is unset", async () => {
    setEnv("CSP_REPORT_SILENCE", undefined);
    setEnv("NODE_ENV", "test");
    const res = await post(hostileV1Report);
    assert.equal(res.status, 204);
    assert.equal(mockRateLimit.mock.callCount(), 1, "the route must still reach the limiter");
    assert.equal(loggedMeta().documentPath, "/reset-password");
  });

  it("drops the report without limiting, parsing, or logging when set to 1 outside production", async () => {
    setEnv("CSP_REPORT_SILENCE", "1");
    setEnv("NODE_ENV", "development");
    const res = await post(hostileV1Report);
    assert.equal(res.status, 204);
    assert.equal(mockRateLimit.mock.callCount(), 0);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  it("only silences on the exact opt-in value, never on any truthy string", async () => {
    setEnv("CSP_REPORT_SILENCE", "true");
    setEnv("NODE_ENV", "development");
    await post(hostileV1Report);
    assert.equal(mockRateLimit.mock.callCount(), 1);
    assert.equal(loggedMeta().violatedDirective, "script-src 'self'");
  });

  it("ignores the variable in production so the live detector cannot be switched off by a stray value", async () => {
    setEnv("CSP_REPORT_SILENCE", "1");
    setEnv("NODE_ENV", "production");
    const res = await post(hostileV1Report);
    assert.equal(res.status, 204);
    assert.equal(mockRateLimit.mock.callCount(), 1, "the route must still reach the limiter");

    const messages = mockLoggerWarn.mock.calls.map(
      (call: { arguments: unknown[] }) => call.arguments[0] as string,
    );
    assert.ok(messages.includes("CSP violation"), `expected a violation line, got ${JSON.stringify(messages)}`);
  });
});
