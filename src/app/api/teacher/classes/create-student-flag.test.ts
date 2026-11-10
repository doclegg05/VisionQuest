import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import type { Session } from "@/lib/api-error";
import { generatePassword } from "@/lib/password-policy";

/**
 * A student account made by staff starts "must change password".
 *
 * The instructor typed the first password and reads it to the student, so the
 * instructor knows it. The student is held to the change-password screen
 * until they pick one nobody else knows (readiness A3).
 */

const teacher: Session = { id: "teacher-1", studentId: "teacher", displayName: "Teacher", role: "teacher" };

interface StudentCreate {
  data: { studentId: string; passwordHash: string; role: string; mustChangePassword?: boolean };
}

const createStudent = mock.fn(async ({ data }: StudentCreate) => ({
  id: "student-1",
  studentId: data.studentId,
  displayName: "New Learner",
  email: null,
}));
const createEnrollment = mock.fn(async (_args: unknown) => ({}));
const audit = mock.fn(async (_event: unknown) => undefined);

// The real auth wrapper and class check run; there is no database.
mock.module("@/lib/auth", { exports: {
  getSession: async () => teacher,
  hashPassword: (_password: string) => ({ hash: "test-only-hash" }),
  normalizeStudentId: (raw: string) => raw.toLowerCase(),
  normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
} });
mock.module("@/lib/db", { exports: {
  prisma: {
    spokesClass: { findFirst: async () => ({ id: "class-1", name: "Morning Class", code: "AM", status: "active" }) },
    student: { findFirst: async () => null },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({ student: { create: createStudent }, studentClassEnrollment: { create: createEnrollment } }),
  },
  prismaAdmin: {},
} });
mock.module("@/lib/audit", { exports: { logAuditEvent: audit } });
mock.module("@/lib/logger", { exports: { logger: { error: mock.fn() } } });

let create: typeof import("./[id]/students/route").POST;
before(async () => {
  ({ POST: create } = await import("./[id]/students/route"));
});
beforeEach(() => {
  createStudent.mock.resetCalls();
  createEnrollment.mock.resetCalls();
  audit.mock.resetCalls();
});

function createWith(password: string): Promise<Response> {
  const request = new Request("http://localhost/api/teacher/classes/class-1/students", {
    method: "POST",
    body: JSON.stringify({ studentId: "newlearner", displayName: "New Learner", password }),
    headers: { "Content-Type": "application/json" },
  });
  return create(request, { params: Promise.resolve({ id: "class-1" }) });
}

describe("instructor creates a student: the student must change the password", () => {
  it("creates the account marked must-change, as a student", async () => {
    const response = await createWith(generatePassword());

    assert.equal(response.status, 200);
    assert.equal(createStudent.mock.callCount(), 1);
    const [{ data }] = createStudent.mock.calls[0]?.arguments ?? [];
    assert.equal(data.role, "student");
    assert.equal(data.passwordHash, "test-only-hash");
    assert.equal(data.mustChangePassword, true);
  });

  it("writes an audit row and a response that hold no password", async () => {
    const password = generatePassword();
    const response = await createWith(password);

    assert.equal(JSON.stringify(await response.json()).includes(password), false);
    assert.equal(JSON.stringify(audit.mock.calls[0]?.arguments[0]).includes(password), false);
  });
});
