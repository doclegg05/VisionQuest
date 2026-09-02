import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Request-level tests for POST /api/appointments/book.
//
// 2026-09-01 review F27 (API-U-02): the availability read is only a fast
// path. The partial unique index Appointment_advisorId_startsAt_scheduled_key
// (migration 20260902140000) makes the second concurrent insert fail with
// Prisma P2002, and the route must answer 409 in plain language.
//
// F26 (API-U-01, book half): side effects run only after the durable write
// and can never turn a saved booking into a failure response.
//
// `prisma.appointment.create` is mocked at @/lib/db, so the P2002 mapping in
// src/lib/appointment-booking.ts runs for real.
// ---------------------------------------------------------------------------

const SLOT = {
  startsAt: "2026-09-10T14:00:00.000Z",
  endsAt: "2026-09-10T14:30:00.000Z",
  locationType: "virtual",
  locationLabel: "Zoom",
  meetingUrl: "https://meet.example.test/advising",
};

const ADVISOR = {
  advisorId: "tch-test-001",
  advisorName: "Test Teacher",
  slots: [SLOT],
};

const STUDENT_A = mockStudentSession({ id: "stu-test-001", studentId: "studenta" });
const STUDENT_B = mockStudentSession({ id: "stu-test-002", studentId: "studentb" });

let currentSession: Session = STUDENT_A;
const callOrder: string[] = [];

type CreateArgs = { data: Record<string, unknown>; select: unknown };
const mockAppointmentCreate = mock.fn<(args: CreateArgs) => Promise<unknown>>();
const mockListBookableAdvisors = mock.fn<(args: unknown) => Promise<unknown[]>>();
const mockSyncStudentAlerts = mock.fn<(studentId: string) => Promise<void>>();
const mockSendAppointmentConfirmation = mock.fn<(appointmentId: string) => Promise<unknown>>();
const mockLogAuditEvent = mock.fn<(input: unknown) => Promise<void>>();
const mockLoggerWarn = mock.fn<(message: string, context?: Record<string, unknown>) => void>();
const mockLoggerError = mock.fn<(message: string, context?: Record<string, unknown>) => void>();

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.name = "ApiError";
  error.statusCode = statusCode;
  return error;
}

function bookedAppointment(id: string) {
  return {
    id,
    title: "Advising session",
    startsAt: new Date(SLOT.startsAt),
    endsAt: new Date(SLOT.endsAt),
    status: "scheduled",
    advisor: { displayName: ADVISOR.advisorName },
  };
}

/** Shape Prisma throws for a unique-constraint violation (code P2002). */
function uniqueViolation() {
  return Object.assign(
    new Error("Unique constraint failed on the fields: (`advisorId`,`startsAt`)"),
    {
      code: "P2002",
      clientVersion: "6.19.3",
      meta: { target: "Appointment_advisorId_startsAt_scheduled_key" },
    },
  );
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          return await handler(currentSession, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
    conflict: (message: string) => makeHttpError(409, message),
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      appointment: { create: mockAppointmentCreate },
    },
  },
});

mock.module("@/lib/advising", {
  namedExports: {
    listBookableAdvisors: mockListBookableAdvisors,
    sendAppointmentConfirmation: mockSendAppointmentConfirmation,
    syncStudentAlerts: mockSyncStudentAlerts,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => {},
      info: () => {},
      warn: mockLoggerWarn,
      error: mockLoggerError,
    },
  },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

function bookingRequest(overrides: Record<string, unknown> = {}): Request {
  return mockRequest("/api/appointments/book", {
    method: "POST",
    body: { advisorId: ADVISOR.advisorId, startsAt: SLOT.startsAt, ...overrides },
  });
}

async function post(session: Session, overrides: Record<string, unknown> = {}) {
  currentSession = session;
  const response = await route.POST(bookingRequest(overrides));
  const body = (await response.json()) as { appointment?: { id: string }; error?: string };
  return { status: response.status, body };
}

describe("POST /api/appointments/book", () => {
  beforeEach(() => {
    callOrder.length = 0;
    currentSession = STUDENT_A;

    mockAppointmentCreate.mock.resetCalls();
    mockListBookableAdvisors.mock.resetCalls();
    mockSyncStudentAlerts.mock.resetCalls();
    mockSendAppointmentConfirmation.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockLoggerWarn.mock.resetCalls();
    mockLoggerError.mock.resetCalls();

    mockListBookableAdvisors.mock.mockImplementation(async () => [ADVISOR]);
    mockAppointmentCreate.mock.mockImplementation(async () => {
      callOrder.push("create");
      return bookedAppointment("appt-1");
    });
    mockSyncStudentAlerts.mock.mockImplementation(async () => {
      callOrder.push("syncStudentAlerts");
    });
    mockLogAuditEvent.mock.mockImplementation(async () => {
      callOrder.push("logAuditEvent");
    });
    mockSendAppointmentConfirmation.mock.mockImplementation(async () => {
      callOrder.push("sendAppointmentConfirmation");
      return { sent: true, recipientCount: 2 };
    });
  });

  describe("F27: the database decides a race for one slot", () => {
    it("first booking 201, second 409 in plain language, no raw Prisma text", async () => {
      // Both students pass the availability fast path; only the insert
      // separates them.
      mockAppointmentCreate.mock.mockImplementationOnce(async () => {
        callOrder.push("create");
        return bookedAppointment("appt-1");
      }, 0);
      mockAppointmentCreate.mock.mockImplementationOnce(async () => {
        throw uniqueViolation();
      }, 1);

      const first = await post(STUDENT_A);
      const second = await post(STUDENT_B);

      assert.equal(first.status, 201);
      assert.equal(first.body.appointment?.id, "appt-1");

      assert.equal(second.status, 409);
      assert.equal(second.body.error, "That time was just taken. Pick another time.");
      const raw = JSON.stringify(second.body);
      assert.doesNotMatch(raw, /P2002|Unique constraint|prisma/i);

      assert.equal(mockAppointmentCreate.mock.callCount(), 2);
      // Side effects belong to the booking that saved, not the one refused.
      assert.equal(mockSyncStudentAlerts.mock.callCount(), 1);
      assert.equal(mockLogAuditEvent.mock.callCount(), 1);
      assert.equal(mockSendAppointmentConfirmation.mock.callCount(), 1);
    });

    it("rethrows a non-P2002 create failure as a 500 with no side effects", async () => {
      mockAppointmentCreate.mock.mockImplementationOnce(async () => {
        throw new Error("connection reset");
      });

      const result = await post(STUDENT_A);

      assert.equal(result.status, 500);
      assert.equal(result.body.error, "Internal server error");
      assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
      assert.equal(mockSendAppointmentConfirmation.mock.callCount(), 0);
    });
  });

  describe("F26: a saved booking is never reported as failed", () => {
    it("side effects that throw after the write still return 201 and log a warning", async () => {
      mockSyncStudentAlerts.mock.mockImplementation(async () => {
        callOrder.push("syncStudentAlerts");
        throw new Error("alerts service down");
      });
      mockSendAppointmentConfirmation.mock.mockImplementation(async () => {
        callOrder.push("sendAppointmentConfirmation");
        throw new Error("smtp timeout");
      });

      const result = await post(STUDENT_A);

      assert.equal(result.status, 201);
      assert.equal(result.body.appointment?.id, "appt-1");
      assert.equal(mockAppointmentCreate.mock.callCount(), 1);

      // One failing effect does not skip the ones after it.
      assert.deepEqual(callOrder, [
        "create",
        "syncStudentAlerts",
        "logAuditEvent",
        "sendAppointmentConfirmation",
      ]);

      assert.equal(mockLoggerWarn.mock.callCount(), 2);
      for (const call of mockLoggerWarn.mock.calls) {
        const [message, context] = call.arguments;
        assert.match(message, /booked|saved/i);
        const serialized = JSON.stringify(context ?? {});
        // No raw student id in the log line, only the hashed log key.
        assert.doesNotMatch(serialized, /stu-test-001|studenta/);
        assert.match(serialized, /appt-1/);
      }
    });
  });

  describe("failures before the write never create a row", () => {
    it("availability lookup failure returns 500 and never calls create", async () => {
      mockListBookableAdvisors.mock.mockImplementation(async () => {
        throw new Error("availability read failed");
      });

      const result = await post(STUDENT_A);

      assert.equal(result.status, 500);
      assert.equal(mockAppointmentCreate.mock.callCount(), 0);
      assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
      assert.equal(mockLogAuditEvent.mock.callCount(), 0);
    });

    it("a slot that is not open returns 409 and never calls create", async () => {
      mockListBookableAdvisors.mock.mockImplementation(async () => [
        { ...ADVISOR, slots: [] },
      ]);

      const result = await post(STUDENT_A);

      assert.equal(result.status, 409);
      assert.equal(result.body.error, "That time slot is no longer available.");
      assert.equal(mockAppointmentCreate.mock.callCount(), 0);
    });

    it("staff sessions are refused before any read or write", async () => {
      const result = await post(mockTeacherSession());

      assert.equal(result.status, 403);
      assert.equal(mockListBookableAdvisors.mock.callCount(), 0);
      assert.equal(mockAppointmentCreate.mock.callCount(), 0);
    });
  });

  describe("happy path", () => {
    it("writes first, then alerts, audit, confirmation, and returns 201 with the appointment", async () => {
      const result = await post(STUDENT_A, { title: "Resume review", description: "Bring my draft" });

      assert.equal(result.status, 201);
      assert.equal(result.body.appointment?.id, "appt-1");

      assert.equal(mockAppointmentCreate.mock.callCount(), 1);
      const { data } = mockAppointmentCreate.mock.calls[0].arguments[0];
      assert.equal(data.studentId, STUDENT_A.id);
      assert.equal(data.advisorId, ADVISOR.advisorId);
      assert.equal(data.title, "Resume review");
      assert.equal(data.description, "Bring my draft");
      assert.equal(data.status, "scheduled");
      assert.equal(data.bookingSource, "student");
      assert.deepEqual(data.startsAt, new Date(SLOT.startsAt));
      assert.deepEqual(data.endsAt, new Date(SLOT.endsAt));
      assert.equal(data.locationType, SLOT.locationType);
      assert.equal(data.meetingUrl, SLOT.meetingUrl);

      assert.deepEqual(callOrder, [
        "create",
        "syncStudentAlerts",
        "logAuditEvent",
        "sendAppointmentConfirmation",
      ]);
      assert.deepEqual(mockSyncStudentAlerts.mock.calls[0].arguments, [STUDENT_A.id]);
      assert.deepEqual(mockSendAppointmentConfirmation.mock.calls[0].arguments, ["appt-1"]);
      assert.equal(mockLoggerWarn.mock.callCount(), 0);
      assert.equal(mockLoggerError.mock.callCount(), 0);
    });
  });
});
