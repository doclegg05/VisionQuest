import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedInternalRequest, isUrlHostMatch } from "./csrf";

describe("CSRF origin validation", () => {
  it("accepts same-origin requests", () => {
    assert.ok(isUrlHostMatch("https://app.example.com", "app.example.com"));
  });

  it("rejects cross-origin requests", () => {
    assert.ok(!isUrlHostMatch("https://evil.com", "app.example.com"));
  });

  it("rejects null origin", () => {
    assert.ok(!isUrlHostMatch(null, "app.example.com"));
  });

  it("rejects malformed origin", () => {
    assert.ok(!isUrlHostMatch("not-a-url", "app.example.com"));
  });

  it("handles port matching", () => {
    assert.ok(isUrlHostMatch("http://localhost:3000", "localhost:3000"));
    assert.ok(!isUrlHostMatch("http://localhost:4000", "localhost:3000"));
  });
});

describe("internal request authorization", () => {
  it("accepts authorized internal automation requests", () => {
    assert.ok(
      isAuthorizedInternalRequest(
        "/api/internal/appointments/reminders",
        "Bearer secret-123",
        "secret-123"
      )
    );
  });

  it("rejects internal requests with the wrong secret", () => {
    assert.ok(
      !isAuthorizedInternalRequest(
        "/api/internal/appointments/reminders",
        "Bearer wrong-secret",
        "secret-123"
      )
    );
  });

  it("does not bypass CSRF for non-internal routes", () => {
    assert.ok(
      !isAuthorizedInternalRequest(
        "/api/auth/login",
        "Bearer secret-123",
        "secret-123"
      )
    );
  });
});
