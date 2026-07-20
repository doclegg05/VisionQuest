/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is intentionally loose across the shared prisma + notification mocks. */
import assert from "node:assert/strict";
import test, { before, beforeEach, describe, it, mock } from "node:test";

// ---------------------------------------------------------------------------
// Module mocks (must be registered before crisis-detection is imported)
// ---------------------------------------------------------------------------

const mockEnrollmentFindMany = mock.fn() as any;
const mockStudentFindUnique = mock.fn() as any;
const mockStudentFindMany = mock.fn() as any;
const mockAlertUpsert = mock.fn() as any;
const mockSendNotification = mock.fn() as any;
const mockEnqueueJob = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: { findMany: mockEnrollmentFindMany },
      student: { findUnique: mockStudentFindUnique, findMany: mockStudentFindMany },
      studentAlert: { upsert: mockAlertUpsert },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      error: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
    },
  },
});

mock.module("@/lib/notifications", {
  namedExports: { sendNotificationWithCooldown: mockSendNotification },
});

mock.module("@/lib/jobs", {
  namedExports: { enqueueJobWithCooldown: mockEnqueueJob },
});

type CrisisModule = typeof import("./crisis-detection");
let detectCrisisSignal: CrisisModule["detectCrisisSignal"];
let recordWellbeingConcern: CrisisModule["recordWellbeingConcern"];

before(async () => {
  const mod = await import("./crisis-detection");
  detectCrisisSignal = mod.detectCrisisSignal;
  recordWellbeingConcern = mod.recordWellbeingConcern;
});

const SKIP_IN_CI = process.version.startsWith("v20.");

// ---------------------------------------------------------------------------
// Positive cases — must be caught (favor recall for safety)
// ---------------------------------------------------------------------------

const SHOULD_MATCH: { text: string; category: string }[] = [
  { text: "honestly I just want to kill myself", category: "self_harm" },
  { text: "sometimes I think about killing myself", category: "self_harm" },
  { text: "I want to end my life", category: "self_harm" },
  { text: "I'm done, I want to end it all", category: "self_harm" },
  { text: "I've been having suicidal thoughts", category: "self_harm" },
  { text: "maybe suicide is the only way out", category: "self_harm" },
  { text: "I just want to die", category: "self_harm" },
  { text: "I wish I was dead", category: "self_harm" },
  { text: "everyone would be better off dead without me", category: "self_harm" },
  { text: "there's no reason to live anymore", category: "self_harm" },
  { text: "I don't want to live like this", category: "self_harm" },
  { text: "I can't go on", category: "self_harm" },
  { text: "I've been cutting myself again", category: "self_harm" },
  { text: "I want to hurt myself", category: "self_harm" },
  { text: "I keep thinking about self-harm", category: "self_harm" },
  { text: "I want to hurt someone", category: "harm_others" },
  { text: "I'm going to kill him", category: "harm_others" },
  { text: "my boyfriend hits me at home", category: "abuse" },
  { text: "I think I'm being abused", category: "abuse" },
];

for (const { text, category } of SHOULD_MATCH) {
  test(`detectCrisisSignal flags: "${text}"`, () => {
    const result = detectCrisisSignal(text);
    assert.equal(result.matched, true, `expected a match for: ${text}`);
    assert.equal(result.category, category);
  });
}

// ---------------------------------------------------------------------------
// Negative cases — must NOT false-positive on common idioms
// ---------------------------------------------------------------------------

const SHOULD_NOT_MATCH = [
  "I'm dying to see my certificate results",
  "this is a killer deal on the course",
  "I'm dead tired after that shift",
  "my goal is to live a better life",
  "I want to live in a bigger city someday",
  "that test almost killed me lol",
  "I need to cut my spending this month",
  "I want to hurt my chances? no, I want to improve them",
  "",
  "I'm feeling great today, ready to go",
];

for (const text of SHOULD_NOT_MATCH) {
  test(`detectCrisisSignal ignores: "${text}"`, () => {
    const result = detectCrisisSignal(text);
    assert.equal(result.matched, false, `unexpected match for: ${text}`);
    assert.equal(result.category, null);
  });
}

test("detectCrisisSignal is case-insensitive", () => {
  assert.equal(detectCrisisSignal("I WANT TO KILL MYSELF").matched, true);
});

test("detectCrisisSignal handles non-string input safely", () => {
  // @ts-expect-error — intentionally passing a non-string to verify the guard
  assert.equal(detectCrisisSignal(null).matched, false);
  // @ts-expect-error — intentionally passing a non-string to verify the guard
  assert.equal(detectCrisisSignal(undefined).matched, false);
});

// ---------------------------------------------------------------------------
// recordWellbeingConcern — notification routing.
// SAFETY: the audience must never be narrower than "all active teachers" on
// any failure path. Assigned instructors are a scoping optimization only.
// ---------------------------------------------------------------------------

const ALL_TEACHERS = [
  { id: "teacher-all-1", email: "all1@example.test" },
  { id: "teacher-all-2", email: "all2@example.test" },
];

function enrollmentWithInstructors(
  instructors: { id: string; email: string | null; isActive: boolean }[],
) {
  return { class: { instructors: instructors.map((instructor) => ({ instructor })) } };
}

function notifiedIds(): string[] {
  return mockSendNotification.mock.calls.map((call: any) => call.arguments[0]);
}

function emailedTo(): string[] {
  return mockEnqueueJob.mock.calls.map((call: any) => call.arguments[0].payload.to);
}

describe("recordWellbeingConcern", { skip: SKIP_IN_CI }, () => {
  beforeEach(() => {
    mockEnrollmentFindMany.mock.resetCalls();
    mockStudentFindUnique.mock.resetCalls();
    mockStudentFindMany.mock.resetCalls();
    mockAlertUpsert.mock.resetCalls();
    mockSendNotification.mock.resetCalls();
    mockEnqueueJob.mock.resetCalls();

    mockEnrollmentFindMany.mock.mockImplementation(async () => []);
    mockStudentFindUnique.mock.mockImplementation(async () => ({
      displayName: "Jane Doe",
      studentId: "S-001",
    }));
    mockStudentFindMany.mock.mockImplementation(async () => ALL_TEACHERS);
    mockAlertUpsert.mock.mockImplementation(async () => ({}));
    mockSendNotification.mock.mockImplementation(async () => ({ sent: true }));
    mockEnqueueJob.mock.mockImplementation(async () => ({ enqueued: true }));
  });

  it("notifies only the student's assigned instructors when they resolve", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => [
      enrollmentWithInstructors([
        { id: "instructor-1", email: "one@example.test", isActive: true },
        { id: "instructor-2", email: null, isActive: true },
      ]),
      enrollmentWithInstructors([
        // Duplicate across classes — must be deduped, not double-notified.
        { id: "instructor-1", email: "one@example.test", isActive: true },
        // Inactive account — must be excluded.
        { id: "instructor-3", email: "gone@example.test", isActive: false },
      ]),
    ]);

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
    });

    assert.equal(mockAlertUpsert.mock.callCount(), 1, "CRITICAL alert row is always created");
    assert.deepEqual(notifiedIds().sort(), ["instructor-1", "instructor-2"]);
    assert.deepEqual(emailedTo(), ["one@example.test"], "no email for instructors without one");
    assert.equal(
      mockStudentFindMany.mock.callCount(),
      0,
      "all-teachers fallback query must not run when instructors resolve",
    );

    // Channel content/cooldowns preserved: in-app 12h cooldown, email job 12h.
    const notifyCall = mockSendNotification.mock.calls[0].arguments;
    assert.equal(notifyCall[1].type, "wellbeing.concern");
    assert.equal(notifyCall[2], 12);
    const emailJob = mockEnqueueJob.mock.calls[0].arguments[0];
    assert.equal(emailJob.type, "send_email");
    assert.equal(emailJob.cooldownHours, 12);
    assert.match(emailJob.payload.text, /No student message text is included/);
  });

  it("falls back to ALL active teachers when the student has no enrollments", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => []);

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
    });

    assert.equal(mockStudentFindMany.mock.callCount(), 1);
    const fallbackWhere = mockStudentFindMany.mock.calls[0].arguments[0].where;
    assert.deepEqual(fallbackWhere, { role: "teacher", isActive: true });
    assert.deepEqual(notifiedIds().sort(), ["teacher-all-1", "teacher-all-2"]);
    assert.deepEqual(emailedTo().sort(), ["all1@example.test", "all2@example.test"]);
    assert.equal(mockAlertUpsert.mock.callCount(), 1);
  });

  it("falls back to ALL active teachers when every assigned instructor is inactive", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => [
      enrollmentWithInstructors([
        { id: "instructor-3", email: "gone@example.test", isActive: false },
      ]),
    ]);

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "low_mood",
    });

    assert.deepEqual(notifiedIds().sort(), ["teacher-all-1", "teacher-all-2"]);
    assert.equal(mockStudentFindMany.mock.callCount(), 1);
  });

  it("falls back to ALL active teachers when instructor resolution throws", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => {
      throw new Error("db exploded");
    });

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
    });

    assert.equal(mockStudentFindMany.mock.callCount(), 1);
    assert.deepEqual(notifiedIds().sort(), ["teacher-all-1", "teacher-all-2"]);
    assert.deepEqual(emailedTo().sort(), ["all1@example.test", "all2@example.test"]);
    assert.equal(mockAlertUpsert.mock.callCount(), 1, "alert row still created on fallback");
  });

  it("still creates the CRITICAL alert and never throws when the notify path fails entirely", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => {
      throw new Error("student lookup down");
    });

    await assert.doesNotReject(
      recordWellbeingConcern({
        studentId: "student-1",
        conversationId: null,
        reason: "message_signal",
      }),
    );

    assert.equal(mockAlertUpsert.mock.callCount(), 1);
  });
});
