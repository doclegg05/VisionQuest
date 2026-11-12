import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// The unknown-token limiter for employer links (A6 review): it must count an
// IPv6 caller by its /64, so rotating addresses inside one network cannot get
// past the limit or mint one limiter row per address.

const limiterKeys: string[] = [];
const rateLimitMock = mock.fn(async (key: string) => {
  limiterKeys.push(key);
  return { success: true, degraded: false, remaining: 1, resetAt: new Date() };
});

mock.module("@/lib/rate-limit", { namedExports: { rateLimit: rateLimitMock } });
mock.module("@/lib/system-config", { namedExports: { getPlainConfigValue: async () => null } });

let resolveEmployerRequest: typeof import("./employer-request").resolveEmployerRequest;

before(async () => {
  const realLink = await import("./employer-link");
  mock.module("./employer-link", {
    namedExports: { ...realLink, resolveEmployerLink: async () => null },
  });
  ({ resolveEmployerRequest } = await import("./employer-request"));
});

beforeEach(() => {
  limiterKeys.length = 0;
});

const TOKEN = "a".repeat(32);

describe("employer link: the unknown-token limiter", () => {
  it("counts two IPv6 addresses in one /64 as one caller", async () => {
    await resolveEmployerRequest(TOKEN, TOKEN, "2001:db8:1:2::1");
    await resolveEmployerRequest(TOKEN, TOKEN, "2001:db8:1:2:ffff::9");
    const unknown = limiterKeys.filter((key) => key.startsWith("connect-employer-unknown:"));
    assert.equal(unknown.length, 2, limiterKeys.join(" | "));
    assert.equal(new Set(unknown).size, 1, unknown.join(" | "));
    assert.equal(unknown[0], "connect-employer-unknown:2001:db8:1:2::/64");
  });

  it("counts a missing address in the shared unknown bucket", async () => {
    await resolveEmployerRequest(TOKEN, TOKEN, null);
    assert.ok(limiterKeys.includes("connect-employer-unknown:unknown"), limiterKeys.join(" | "));
  });
});
