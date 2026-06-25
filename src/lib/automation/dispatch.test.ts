import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import {
  automationsEnabled,
  buildEnvelope,
  dispatchAutomationEvent,
  isKnownEventType,
  signPayload,
  stripPii,
} from "./dispatch";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("stripPii", () => {
  it("drops denylisted keys at any depth, case-insensitively", () => {
    const cleaned = stripPii({
      studentId: "abc",
      Name: "Jane Doe",
      email: "j@x.com",
      nested: { phone: "555", content: "secret note", keep: 1 },
      list: [{ ssn: "x", ok: true }],
    }) as Record<string, unknown>;
    assert.deepEqual(cleaned, {
      studentId: "abc",
      nested: { keep: 1 },
      list: [{ ok: true }],
    });
  });
});

describe("buildEnvelope", () => {
  it("produces a stable, PII-stripped envelope", () => {
    const env = buildEnvelope(
      "student.concern.recorded",
      { studentId: "s1", email: "leak@x.com", link: "/teacher/students/s1" },
      "evt-1",
      "2026-06-25T00:00:00.000Z",
    );
    assert.deepEqual(env, {
      id: "evt-1",
      type: "student.concern.recorded",
      occurredAt: "2026-06-25T00:00:00.000Z",
      source: "visionquest",
      data: { studentId: "s1", link: "/teacher/students/s1" },
    });
    assert.ok(!JSON.stringify(env).includes("leak@x.com"), "PII must not survive into the envelope");
  });
});

describe("signPayload", () => {
  it("is a verifiable HMAC-SHA256 over the raw body", () => {
    const body = '{"a":1}';
    const expected = "sha256=" + createHmac("sha256", "shh").update(body, "utf8").digest("hex");
    assert.equal(signPayload(body, "shh"), expected);
    assert.notEqual(signPayload(body, "shh"), signPayload(body, "other"));
  });
});

describe("isKnownEventType", () => {
  it("recognizes catalog events and rejects others", () => {
    assert.ok(isKnownEventType("student.concern.recorded"));
    assert.ok(!isKnownEventType("student.delete.everything"));
  });
});

describe("dispatchAutomationEvent gating", () => {
  it("is a no-op when AUTOMATIONS_ENABLED is not true", async () => {
    process.env.AUTOMATIONS_ENABLED = "false";
    process.env.AUTOMATION_WEBHOOK_URL = "https://example.com/hook";
    process.env.AUTOMATION_WEBHOOK_SECRET = "s";
    assert.equal(automationsEnabled(), false);
    const r = await dispatchAutomationEvent("certification.earned", { studentId: "x" });
    assert.deepEqual(r, { status: "disabled" });
  });

  it("reports unconfigured when enabled but URL/secret missing (no network)", async () => {
    process.env.AUTOMATIONS_ENABLED = "true";
    delete process.env.AUTOMATION_WEBHOOK_URL;
    delete process.env.AUTOMATION_WEBHOOK_SECRET;
    const r = await dispatchAutomationEvent("certification.earned", { studentId: "x" });
    assert.deepEqual(r, { status: "unconfigured" });
  });
});
