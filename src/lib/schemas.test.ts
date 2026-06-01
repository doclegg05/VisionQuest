import assert from "node:assert/strict";
import test from "node:test";
import {
  loginSchema,
  createStudentSchema,
  chatSendSchema,
  apiKeySchema,
  parseBody,
  opportunityApplicationSchema,
  bookAppointmentSchema,
  shareCredentialSchema,
  deleteFileSchema,
  deleteByIdSchema,
} from "./schemas";

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
    password: "secure-pass-123",
  });
  assert.ok(result.success);
});

test("createStudentSchema accepts optional email", () => {
  const result = createStudentSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane Doe",
    email: "jane@example.com",
    password: "secure-pass-123",
  });
  assert.ok(result.success);
});

test("createStudentSchema requires username min 3 chars", () => {
  const result = createStudentSchema.safeParse({
    studentId: "ab",
    displayName: "Jane",
    password: "secure-pass-123",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("3 characters"));
});

test("createStudentSchema requires password min 12 chars", () => {
  const result = createStudentSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane",
    password: "short-11chr",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("12 characters"));
});

test("createStudentSchema allows empty string for email", () => {
  const result = createStudentSchema.safeParse({
    studentId: "jdoe",
    displayName: "Jane",
    password: "secure-pass-123",
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

test("chatSendSchema accepts staff targetStudentId context", () => {
  const cuid = "cm1234567890abcdefghijklm";
  const result = chatSendSchema.safeParse({ message: "Report on this student", targetStudentId: cuid });
  assert.ok(result.success);
  assert.equal(result.data.targetStudentId, cuid);
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

// ---------------------------------------------------------------------------
// opportunityApplicationSchema
// ---------------------------------------------------------------------------

test("opportunityApplicationSchema applies defaults for a minimal body", () => {
  const result = opportunityApplicationSchema.safeParse({ opportunityId: "opp1" });
  assert.ok(result.success);
  assert.equal(result.data.status, "saved");
  assert.equal(result.data.notes, "");
  assert.equal(result.data.resumeFileId, "");
});

test("opportunityApplicationSchema trims notes and keeps a valid status", () => {
  const result = opportunityApplicationSchema.safeParse({
    opportunityId: "opp1",
    status: "applied",
    notes: "  follow up  ",
  });
  assert.ok(result.success);
  assert.equal(result.data.status, "applied");
  assert.equal(result.data.notes, "follow up");
});

test("opportunityApplicationSchema rejects a missing opportunityId", () => {
  const result = opportunityApplicationSchema.safeParse({});
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.path[0] === "opportunityId"));
});

test("opportunityApplicationSchema rejects an invalid status", () => {
  const result = opportunityApplicationSchema.safeParse({ opportunityId: "opp1", status: "bogus" });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("invalid"));
});

// ---------------------------------------------------------------------------
// bookAppointmentSchema
// ---------------------------------------------------------------------------

test("bookAppointmentSchema accepts a minimal booking and defaults optionals", () => {
  const result = bookAppointmentSchema.safeParse({ advisorId: "adv1", startsAt: "2026-06-01T15:00:00Z" });
  assert.ok(result.success);
  assert.equal(result.data.title, "");
  assert.equal(result.data.description, "");
});

test("bookAppointmentSchema rejects a missing time slot", () => {
  const result = bookAppointmentSchema.safeParse({ advisorId: "adv1" });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.path[0] === "startsAt"));
});

// ---------------------------------------------------------------------------
// shareCredentialSchema
// ---------------------------------------------------------------------------

test("shareCredentialSchema defaults isPublic to false", () => {
  const result = shareCredentialSchema.safeParse({});
  assert.ok(result.success);
  assert.equal(result.data.isPublic, false);
  assert.equal(result.data.headline, "");
});

test("shareCredentialSchema rejects a non-boolean isPublic", () => {
  const result = shareCredentialSchema.safeParse({ isPublic: "yes" });
  assert.ok(!result.success);
});

// ---------------------------------------------------------------------------
// deleteFileSchema
// ---------------------------------------------------------------------------

test("deleteFileSchema requires a non-empty id", () => {
  assert.ok(deleteFileSchema.safeParse({ id: "file1" }).success);
  assert.ok(!deleteFileSchema.safeParse({ id: "" }).success);
  assert.ok(!deleteFileSchema.safeParse({}).success);
});

// ---------------------------------------------------------------------------
// deleteByIdSchema
// ---------------------------------------------------------------------------

test("deleteByIdSchema requires a valid cuid", () => {
  assert.ok(deleteByIdSchema.safeParse({ id: "ckv1q2w3e4r5t6y7u8i9o0p1" }).success);
  assert.ok(!deleteByIdSchema.safeParse({ id: "not-a-cuid" }).success);
  assert.ok(!deleteByIdSchema.safeParse({ id: "" }).success);
  assert.ok(!deleteByIdSchema.safeParse({}).success);
});

// ---------------------------------------------------------------------------
// parseBody (shared helper)
// ---------------------------------------------------------------------------

function jsonRequest(body: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

test("parseBody returns validated, defaulted data for a valid body", async () => {
  const data = await parseBody(jsonRequest(JSON.stringify({ opportunityId: "opp1" })), opportunityApplicationSchema);
  assert.equal(data.opportunityId, "opp1");
  assert.equal(data.status, "saved");
});

test("parseBody throws badRequest (400) on malformed JSON", async () => {
  await assert.rejects(
    () => parseBody(jsonRequest("{ not json"), deleteFileSchema),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
  );
});

test("parseBody throws badRequest (400) when the body fails validation", async () => {
  await assert.rejects(
    () => parseBody(jsonRequest(JSON.stringify({})), deleteFileSchema),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
  );
});
