/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding intentionally loose for route harnesses */
/**
 * Sign-in maturity contract — Google OAuth authorize (start) probes.
 *
 * Goal 0 instrument: asserts the mature contract. Failures against today's
 * code are the baseline Goal 1 will turn green. Do not weaken these cases
 * to make the suite pass — freeze them once Goal 0 lands.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

const cookieJar = new Map<string, { value: string; options?: Record<string, unknown> }>();

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => {
        const entry = cookieJar.get(name);
        return entry ? { value: entry.value } : undefined;
      },
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        cookieJar.set(name, { value, options });
      },
      delete: (name: string) => {
        cookieJar.delete(name);
      },
    }),
  },
});

let googleStartRoute: Awaited<typeof import("../google/route")>;

before(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";
  process.env.NODE_ENV = "test";
  googleStartRoute = await import("../google/route");
});

describe("sign-in maturity — OAuth authorize (start)", () => {
  beforeEach(() => {
    cookieJar.clear();
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";
  });

  it("MATURITY: sets an httpOnly oauth-state cookie for CSRF binding", async () => {
    const req = mockRequest("/api/auth/google", { method: "GET" });
    const res = await googleStartRoute.GET(req as never);

    assert.ok(res.status >= 300 && res.status < 400, "expected redirect to Google");
    const stateCookie = cookieJar.get("oauth-state");
    assert.ok(stateCookie, "oauth-state cookie must be set");
    assert.equal(stateCookie.options?.httpOnly, true);
    assert.equal(stateCookie.options?.sameSite, "lax");
    assert.ok(typeof stateCookie.value === "string" && stateCookie.value.length >= 32);
  });

  it("MATURITY: authorize URL includes PKCE code_challenge and code_challenge_method=S256", async () => {
    const req = mockRequest("/api/auth/google", { method: "GET" });
    const res = await googleStartRoute.GET(req as never);
    const location = res.headers.get("location");
    assert.ok(location, "redirect Location required");

    const url = new URL(location);
    assert.equal(url.hostname, "accounts.google.com");
    assert.ok(
      url.searchParams.get("code_challenge"),
      "PKCE code_challenge must be present on the authorize URL",
    );
    assert.equal(
      url.searchParams.get("code_challenge_method"),
      "S256",
      "PKCE code_challenge_method must be S256",
    );
  });

  it("MATURITY: authorize URL includes state matching the oauth-state cookie", async () => {
    const req = mockRequest("/api/auth/google", { method: "GET" });
    const res = await googleStartRoute.GET(req as never);
    const location = res.headers.get("location");
    assert.ok(location);
    const url = new URL(location);
    const stateCookie = cookieJar.get("oauth-state");
    assert.ok(stateCookie);
    assert.equal(url.searchParams.get("state"), stateCookie.value);
  });
});
