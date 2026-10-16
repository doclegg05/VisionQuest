import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import * as realCrypto from "node:crypto";

// A timing property cannot be measured reliably in a unit test, so this
// checks the mechanism instead: every comparison, whatever the header length,
// goes through crypto.timingSafeEqual on two 32-byte digests. An early
// return on a length mismatch, or a plain string compare, never reaches it.
const timingSafeEqual = mock.fn(realCrypto.timingSafeEqual);
// Only the two functions csrf.ts uses: spreading the whole builtin fails,
// because Node will not redefine `constants` on it.
mock.module("node:crypto", { exports: { createHash: realCrypto.createHash, timingSafeEqual } });

let csrf: typeof import("./csrf");
before(async () => {
  csrf = await import("./csrf");
});

const PATH = "/api/internal/jobs/process";
const SECRET = "a-cron-secret-that-is-much-longer-than-the-guess";

function digestLengths(): number[][] {
  return timingSafeEqual.mock.calls.map((call) =>
    call.arguments.map((buffer) => (buffer as Uint8Array).byteLength),
  );
}

describe("isAuthorizedInternalRequest compares without leaking the secret's length", () => {
  beforeEach(() => timingSafeEqual.mock.resetCalls());

  it("still runs a fixed-length comparison when the header is shorter than the secret", () => {
    assert.equal(csrf.isAuthorizedInternalRequest(PATH, "Bearer x", SECRET), false);
    assert.deepEqual(digestLengths(), [[32, 32]]);
  });

  it("still runs a fixed-length comparison when the header is longer than the secret", () => {
    assert.equal(csrf.isAuthorizedInternalRequest(PATH, `Bearer ${SECRET}${SECRET}`, SECRET), false);
    assert.deepEqual(digestLengths(), [[32, 32]]);
  });

  it("accepts the exact header through the same comparison", () => {
    assert.equal(csrf.isAuthorizedInternalRequest(PATH, `Bearer ${SECRET}`, SECRET), true);
    assert.deepEqual(digestLengths(), [[32, 32]]);
  });

  it("rejects a same-length header that differs in one character", () => {
    const guess = `Bearer ${SECRET.slice(0, -1)}X`;
    assert.equal(csrf.isAuthorizedInternalRequest(PATH, guess, SECRET), false);
  });
});

describe("isAuthorizedInternalRoute", () => {
  function request(path: string, authorization?: string): Request {
    return new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: authorization ? { authorization } : {},
    });
  }

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("accepts the cron bearer on an internal path", () => {
    assert.equal(csrf.isAuthorizedInternalRoute(request(PATH, `Bearer ${SECRET}`)), true);
  });

  it("rejects a wrong or missing bearer", () => {
    assert.equal(csrf.isAuthorizedInternalRoute(request(PATH, "Bearer wrong")), false);
    assert.equal(csrf.isAuthorizedInternalRoute(request(PATH)), false);
  });

  it("rejects everyone when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    assert.equal(csrf.isAuthorizedInternalRoute(request(PATH, "Bearer undefined")), false);
  });

  it("rejects a path outside /api/internal", () => {
    assert.equal(csrf.isAuthorizedInternalRoute(request("/api/auth/login", `Bearer ${SECRET}`)), false);
  });
});
