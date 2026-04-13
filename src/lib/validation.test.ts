import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail,
  isValidUrl,
  isSafeAiProviderUrl,
  checkLength,
  requireString,
  MAX_LENGTHS,
} from "./validation";

describe("isValidEmail", () => {
  it("accepts valid emails", () => {
    assert.ok(isValidEmail("user@example.com"));
    assert.ok(isValidEmail("test.user+tag@sub.domain.org"));
    assert.ok(isValidEmail("a@b.co"));
  });

  it("rejects invalid emails", () => {
    assert.ok(!isValidEmail(""));
    assert.ok(!isValidEmail("noatsign"));
    assert.ok(!isValidEmail("@nodomain.com"));
    assert.ok(!isValidEmail("user@"));
    assert.ok(!isValidEmail("user @example.com"));
    assert.ok(!isValidEmail("a".repeat(255) + "@example.com"));
  });
});

describe("isValidUrl", () => {
  it("accepts http and https URLs", () => {
    assert.ok(isValidUrl("https://example.com"));
    assert.ok(isValidUrl("http://localhost:3000/path"));
  });

  it("rejects non-http protocols", () => {
    assert.ok(!isValidUrl("ftp://example.com"));
    assert.ok(!isValidUrl("javascript:alert(1)"));
    assert.ok(!isValidUrl("not-a-url"));
  });
});

describe("isSafeAiProviderUrl", () => {
  it("accepts loopback and public endpoints", () => {
    assert.ok(isSafeAiProviderUrl("http://localhost:11434"));
    assert.ok(isSafeAiProviderUrl("http://127.0.0.1:11434"));
    assert.ok(isSafeAiProviderUrl("https://llm.example.com"));
  });

  it("rejects private and link-local endpoints", () => {
    assert.ok(!isSafeAiProviderUrl("http://10.0.0.8:11434"));
    assert.ok(!isSafeAiProviderUrl("http://192.168.1.25:11434"));
    assert.ok(!isSafeAiProviderUrl("http://169.254.169.254/latest/meta-data"));
  });
});

describe("checkLength", () => {
  it("returns null for strings within limits", () => {
    assert.equal(checkLength("hello", "title"), null);
  });

  it("returns error for strings exceeding limits", () => {
    const long = "x".repeat(MAX_LENGTHS.title + 1);
    const err = checkLength(long, "title");
    assert.ok(err !== null);
    assert.ok(err!.includes(String(MAX_LENGTHS.title)));
  });
});

describe("requireString", () => {
  it("trims and validates", () => {
    const result = requireString("  hello  ", "title");
    assert.equal(result.value, "hello");
    assert.equal(result.error, null);
  });

  it("rejects empty strings", () => {
    const result = requireString("   ", "title");
    assert.equal(result.value, "");
    assert.ok(result.error !== null);
  });

  it("rejects non-strings", () => {
    const result = requireString(123, "title");
    assert.equal(result.value, "");
    assert.ok(result.error !== null);
  });
});
