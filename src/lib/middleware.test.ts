import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAuthorizedInternalRequest, isSignedWebhookPath, SIGNED_WEBHOOK_PATHS } from "./csrf";
import { isUrlHostMatch } from "./csrf";

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

  // Without the unset-secret guard, `Bearer ${undefined}` would match a
  // caller who sends the literal text, opening every /api/internal route
  // whenever CRON_SECRET is missing.
  it("rejects every caller when CRON_SECRET is unset or empty", () => {
    assert.ok(!isAuthorizedInternalRequest("/api/internal/jobs/process", "Bearer undefined", undefined));
    assert.ok(!isAuthorizedInternalRequest("/api/internal/jobs/process", "Bearer ", ""));
  });
});

describe("signed third-party webhooks", () => {
  it("exempts the Twilio inbound path, and nothing else", () => {
    assert.deepEqual([...SIGNED_WEBHOOK_PATHS], ["/api/sms/inbound"]);
    assert.ok(isSignedWebhookPath("/api/sms/inbound"));
    for (const path of [
      "/api/sms/inbound/",
      "/api/sms/inbound/anything",
      "/api/sms",
      "/api/auth/login",
    ]) {
      assert.ok(!isSignedWebhookPath(path), `${path} must not be exempt`);
    }
  });

  it("every exempt path verifies a provider signature before it acts", () => {
    // The exemption is only safe because the route authenticates the request
    // itself. A path added to the list without a signature check would be an
    // unauthenticated write endpoint, so the list is checked against the code.
    for (const path of SIGNED_WEBHOOK_PATHS) {
      const source = readFileSync(`src/app${path}/route.ts`, "utf8");
      assert.match(
        source,
        /verifyTwilioSignature|verify[A-Za-z]*Signature/,
        `${path} is CSRF-exempt but verifies no signature`,
      );
    }
  });
});

describe("intake webhook authorization", () => {
  it("accepts the intake webhook secret", () => {
    assert.ok(
      isAuthorizedInternalRequest(
        "/api/intake/webhook",
        "Bearer intake-secret",
        "cron-secret",
        "intake-secret",
      ),
    );
  });

  it("does not accept CRON_SECRET on the intake webhook", () => {
    // The webhook secret lives with an external SaaS (Power Automate). If it
    // could fall back to CRON_SECRET, one vendor-side leak would authenticate
    // every /api/internal/* cron endpoint.
    assert.ok(
      !isAuthorizedInternalRequest(
        "/api/intake/webhook",
        "Bearer cron-secret",
        "cron-secret",
        "intake-secret",
      ),
    );
  });

  it("refuses the intake webhook when its own secret is unset", () => {
    assert.ok(
      !isAuthorizedInternalRequest("/api/intake/webhook", "Bearer cron-secret", "cron-secret"),
    );
    assert.ok(
      !isAuthorizedInternalRequest("/api/intake/webhook", "Bearer cron-secret", "cron-secret", ""),
    );
  });

  it("does not accept the intake secret on internal cron routes", () => {
    assert.ok(
      !isAuthorizedInternalRequest(
        "/api/internal/appointments/reminders",
        "Bearer intake-secret",
        "cron-secret",
        "intake-secret",
      ),
    );
  });

  it("matches the webhook path exactly", () => {
    assert.ok(
      !isAuthorizedInternalRequest(
        "/api/intake/webhook/replay",
        "Bearer intake-secret",
        "cron-secret",
        "intake-secret",
      ),
    );
  });
});
