import assert from "node:assert/strict";
import test from "node:test";
import { loginSchema, createStudentSchema, chatSendSchema, apiKeySchema } from "./schemas";

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
// createStudentSchema
// ---------------------------------------------------------------------------

test("createStudentSchema accepts valid input", () => {
  const result = createStudentSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane Doe",
    password: "secure123",
  });
  assert.ok(result.success);
});

test("createStudentSchema accepts optional email", () => {
  const result = createStudentSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane Doe",
    email: "jane@example.com",
    password: "secure123",
  });
  assert.ok(result.success);
});

test("createStudentSchema requires username min 3 chars", () => {
  const result = createStudentSchema.safeParse({
    studentId: "ab",
    displayName: "Jane",
    password: "secure123",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("3 characters"));
});

test("createStudentSchema requires password min 8 chars", () => {
  const result = createStudentSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane",
    password: "1234567",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("8 characters"));
});

test("createStudentSchema allows empty string for email", () => {
  const result = createStudentSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane",
    password: "secure123",
    email: "",
  });
  assert.ok(result.success);
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
  const cuid = "cm1234567890abcdefghijklm";
  const result = chatSendSchema.safeParse({ message: "Hi", conversationId: cuid });
  assert.ok(result.success);
  assert.equal(result.data.conversationId, cuid);
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
