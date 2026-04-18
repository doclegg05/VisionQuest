/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is intentionally loose across the shared prisma + logger mocks. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { AIProvider } from "@/lib/ai";

const mockEnrollmentFindFirst = mock.fn() as any;
const mockStudentUpdate = mock.fn() as any;
const mockAlertUpsert = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: { findFirst: mockEnrollmentFindFirst },
      student: { update: mockStudentUpdate },
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

type DetectFn = (typeof import("./classroom-confirmation"))["detectAndRecordClassroomConfirmation"];
let detectAndRecordClassroomConfirmation: DetectFn;

before(async () => {
  const mod = await import("./classroom-confirmation");
  detectAndRecordClassroomConfirmation = mod.detectAndRecordClassroomConfirmation;
});

const SKIP_IN_CI = process.version.startsWith("v20.");

function makeProvider(response: string): AIProvider {
  return {
    name: "mock",
    generateResponse: async () => "",
    generateStructuredResponse: async () => response,
    streamResponse: async function* () {},
  } as unknown as AIProvider;
}

describe("detectAndRecordClassroomConfirmation", { skip: SKIP_IN_CI }, () => {
  beforeEach(() => {
    mockEnrollmentFindFirst.mock.resetCalls();
    mockStudentUpdate.mock.resetCalls();
    mockAlertUpsert.mock.resetCalls();
  });

  it("sets classroomConfirmedAt when the student names their enrolled classroom", async () => {
    mockEnrollmentFindFirst.mock.mockImplementationOnce(async () => ({
      id: "enrollment-1",
      class: { id: "class-1", name: "Mrs. Thompson Monday AM" },
    }));
    mockStudentUpdate.mock.mockImplementationOnce(async () => ({}));

    const provider = makeProvider(
      JSON.stringify({
        confirmed: true,
        confidence: 0.95,
        classroom_mentioned: "Mrs. Thompson's class",
        instructor_mentioned: "Mrs. Thompson",
      }),
    );

    const result = await detectAndRecordClassroomConfirmation(
      provider,
      "student-1",
      "I'm in Mrs. Thompson's Monday class",
      "Welcome!",
    );

    assert.equal(result.confirmed, true);
    assert.equal(result.mismatch, false);
    assert.equal(result.noSignal, false);
    assert.equal(mockStudentUpdate.mock.callCount(), 1);
    assert.equal(mockAlertUpsert.mock.callCount(), 0);

    const updateArgs = mockStudentUpdate.mock.calls[0].arguments[0];
    assert.equal(updateArgs.where.id, "student-1");
    assert.ok(updateArgs.data.classroomConfirmedAt instanceof Date);
  });

  it("raises a classroom_mismatch alert when the student names a different classroom", async () => {
    mockEnrollmentFindFirst.mock.mockImplementationOnce(async () => ({
      id: "enrollment-1",
      class: { id: "class-1", name: "Mrs. Thompson Monday AM" },
    }));
    mockAlertUpsert.mock.mockImplementationOnce(async () => ({}));

    const provider = makeProvider(
      JSON.stringify({
        confirmed: true,
        confidence: 0.92,
        classroom_mentioned: "Mr. Davis Tuesday",
        instructor_mentioned: "Mr. Davis",
      }),
    );

    const result = await detectAndRecordClassroomConfirmation(
      provider,
      "student-1",
      "I'm in Mr. Davis's Tuesday class",
      "Sure — which classroom are you in?",
    );

    assert.equal(result.confirmed, false);
    assert.equal(result.mismatch, true);
    assert.equal(result.noSignal, false);
    assert.equal(mockStudentUpdate.mock.callCount(), 0);
    assert.equal(mockAlertUpsert.mock.callCount(), 1);

    const alertArgs = mockAlertUpsert.mock.calls[0].arguments[0];
    assert.equal(alertArgs.create.type, "classroom_mismatch");
    assert.equal(alertArgs.create.studentId, "student-1");
    assert.equal(alertArgs.create.sourceType, "classroom_confirmation");
    assert.equal(alertArgs.where.alertKey, "classroom_mismatch:student-1");
  });

  it("is a no-op when the student dodged the question", async () => {
    const provider = makeProvider(
      JSON.stringify({
        confirmed: false,
        confidence: 0.0,
        classroom_mentioned: null,
        instructor_mentioned: null,
      }),
    );

    const result = await detectAndRecordClassroomConfirmation(
      provider,
      "student-1",
      "I don't really want to talk about class right now",
      "What classroom are you in?",
    );

    assert.equal(result.confirmed, false);
    assert.equal(result.mismatch, false);
    assert.equal(result.noSignal, true);
    assert.equal(mockEnrollmentFindFirst.mock.callCount(), 0);
    assert.equal(mockStudentUpdate.mock.callCount(), 0);
    assert.equal(mockAlertUpsert.mock.callCount(), 0);
  });

  it("is a no-op when confidence is below the threshold", async () => {
    const provider = makeProvider(
      JSON.stringify({
        confirmed: true,
        confidence: 0.5,
        classroom_mentioned: "maybe Ms. Ramos?",
        instructor_mentioned: null,
      }),
    );

    const result = await detectAndRecordClassroomConfirmation(
      provider,
      "student-1",
      "Maybe Ms. Ramos? I'm not sure",
      "Which classroom are you in?",
    );

    assert.equal(result.noSignal, true);
    assert.equal(mockStudentUpdate.mock.callCount(), 0);
    assert.equal(mockAlertUpsert.mock.callCount(), 0);
  });

  it("raises a classroom_intake_pending alert when the student has no active enrollment", async () => {
    mockEnrollmentFindFirst.mock.mockImplementationOnce(async () => null);
    mockAlertUpsert.mock.mockImplementationOnce(async () => ({}));

    const provider = makeProvider(
      JSON.stringify({
        confirmed: true,
        confidence: 0.9,
        classroom_mentioned: "Mrs. Jackson's class",
        instructor_mentioned: "Mrs. Jackson",
      }),
    );

    const result = await detectAndRecordClassroomConfirmation(
      provider,
      "student-1",
      "I'm in Mrs. Jackson's class",
      "Got it — which classroom are you in?",
    );

    assert.equal(result.confirmed, false);
    assert.equal(result.mismatch, true);
    assert.equal(result.noSignal, false);
    assert.equal(mockStudentUpdate.mock.callCount(), 0);
    assert.equal(mockAlertUpsert.mock.callCount(), 1);

    const alertArgs = mockAlertUpsert.mock.calls[0].arguments[0];
    assert.equal(alertArgs.create.type, "classroom_intake_pending");
  });

  it("swallows extractor errors and reports noSignal", async () => {
    const provider: AIProvider = {
      name: "mock",
      generateResponse: async () => "",
      generateStructuredResponse: async () => {
        throw new Error("LLM exploded");
      },
      streamResponse: async function* () {},
    } as unknown as AIProvider;

    const result = await detectAndRecordClassroomConfirmation(
      provider,
      "student-1",
      "hi",
      "hi back",
    );

    assert.equal(result.confirmed, false);
    assert.equal(result.mismatch, false);
    assert.equal(result.noSignal, true);
  });
});
