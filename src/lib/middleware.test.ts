import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the CSRF logic in isolation (middleware runs in edge runtime,
// so we test the validation logic rather than the full middleware)

function isOriginValid(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === host;
  } catch {
    return false;
  }
}

describe("CSRF origin validation", () => {
  it("accepts same-origin requests", () => {
    assert.ok(isOriginValid("https://app.example.com", "app.example.com"));
  });

  it("rejects cross-origin requests", () => {
    assert.ok(!isOriginValid("https://evil.com", "app.example.com"));
  });

  it("rejects null origin", () => {
    assert.ok(!isOriginValid(null, "app.example.com"));
  });

  it("rejects malformed origin", () => {
    assert.ok(!isOriginValid("not-a-url", "app.example.com"));
  });

  it("handles port matching", () => {
    assert.ok(isOriginValid("http://localhost:3000", "localhost:3000"));
    assert.ok(!isOriginValid("http://localhost:4000", "localhost:3000"));
  });
});
