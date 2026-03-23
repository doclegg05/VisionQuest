import assert from "node:assert/strict";
import test from "node:test";
import { loginSchema, registerSchema, chatSendSchema, apiKeySchema } from "./schemas";

// ---------------------------------------------------------------------------
// loginSchema
// ---------------------------------------------------------------------------

test("loginSchema accepts valid input", () => {
  const result = loginSchema.safeParse({ studentId: "jdoe", password: "abc123" });
  assert.ok(result.success);
  assert.equal(result.data.studentId, "jdoe");
});

test("loginSchema rejects empty studentId", () => {
  const result = loginSchema.safeParse({ studentId: "", password: "abc123" });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("Student ID"));
});

test("loginSchema rejects missing password", () => {
  const result = loginSchema.safeParse({ studentId: "jdoe" });
  assert.ok(!result.success);
});

test("loginSchema rejects studentId over 50 chars", () => {
  const result = loginSchema.safeParse({ studentId: "a".repeat(51), password: "abc123" });
  assert.ok(!result.success);
});

// ---------------------------------------------------------------------------
// registerSchema
// ---------------------------------------------------------------------------

test("registerSchema accepts valid input", () => {
  const result = registerSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane Doe",
    email: "jane@example.com",
    password: "secure123",
    inviteToken: "valid-invite-token",
  });
  assert.ok(result.success);
});

test("registerSchema requires studentId min 3 chars", () => {
  const result = registerSchema.safeParse({
    studentId: "ab",
    displayName: "Jane",
    email: "j@e.com",
    password: "secure123",
    inviteToken: "valid-invite-token",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("3 characters"));
});

test("registerSchema requires valid email", () => {
  const result = registerSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane",
    email: "notanemail",
    password: "secure123",
    inviteToken: "valid-invite-token",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("email"));
});

test("registerSchema requires password min 6 chars", () => {
  const result = registerSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane",
    email: "j@e.com",
    password: "12345",
    inviteToken: "valid-invite-token",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("6 characters"));
});

test("registerSchema requires an invite token", () => {
  const result = registerSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane Doe",
    email: "jane@example.com",
    password: "secure123",
  });
  assert.ok(!result.success);
  assert.equal(result.error.issues[0]?.path[0], "inviteToken");
});

test("registerSchema allows optional securityQuestions", () => {
  const result = registerSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane",
    email: "j@e.com",
    password: "secure123",
    inviteToken: "valid-invite-token",
    securityQuestions: {
      birth_city: "Morgantown",
      elementary_school: "Lincoln",
      favorite_teacher: "Jones",
    },
  });
  assert.ok(result.success);
});

test("registerSchema rejects the legacy securityQuestions array shape", () => {
  const result = registerSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane",
    email: "j@e.com",
    password: "secure123",
    inviteToken: "valid-invite-token",
    securityQuestions: [{ questionId: "q1", answer: "blue" }],
  });
  assert.ok(!result.success);
});

// ---------------------------------------------------------------------------
// chatSendSchema
// ---------------------------------------------------------------------------

test("chatSendSchema accepts valid message", () => {
  const result = chatSendSchema.safeParse({ message: "Hello Sage!" });
  assert.ok(result.success);
  assert.equal(result.data.message, "Hello Sage!");
  assert.equal(result.data.conversationId, undefined);
});

test("chatSendSchema accepts message with conversationId", () => {
  const result = chatSendSchema.safeParse({ message: "Hi", conversationId: "abc123" });
  assert.ok(result.success);
  assert.equal(result.data.conversationId, "abc123");
});

test("chatSendSchema rejects empty message", () => {
  const result = chatSendSchema.safeParse({ message: "" });
  assert.ok(!result.success);
});

test("chatSendSchema rejects message over 10000 chars", () => {
  const result = chatSendSchema.safeParse({ message: "a".repeat(10001) });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("10,000"));
});

// ---------------------------------------------------------------------------
// apiKeySchema
// ---------------------------------------------------------------------------

test("apiKeySchema accepts valid key", () => {
  const result = apiKeySchema.safeParse({ apiKey: "AIza..." });
  assert.ok(result.success);
});

test("apiKeySchema rejects empty key", () => {
  const result = apiKeySchema.safeParse({ apiKey: "" });
  assert.ok(!result.success);
});
