import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import type { Session } from "@/lib/api-error";
import { generatePassword } from "@/lib/password-policy";

/**
 * An instructor reset marks the account "must change password".
 *
 * The instructor typed the new password, so the instructor knows it. The
 * student is held to the change-password screen until they pick one nobody
 * else knows (readiness A3). The mark and the session-version bump go in the
 * same write: the bump ends every session the student has, so no token signed
 * before the reset can outlive it without the must-change claim.
 */

const teacher: Session = { id: "teacher-1", studentId: "teacher", displayName: "Teacher", role: "teacher" };

interface StudentUpdate {
  where: { id: string; role: string };
  data: { passwordHash: string; mustChangePassword?: boolean; sessionVersion?: { increment: number } };
}

const update = mock.fn(async (_args: StudentUpdate) => ({}));
const deleteTokens = mock.fn(async (_args: unknown) => ({ count: 0 }));
const audit = mock.fn(async (_event: { action: string; summary: string; metadata?: unknown }) => undefined);

// The real auth wrapper and classroom check run; there is no database.
mock.module("@/lib/auth", { exports: {
  getSession: async () => teacher,
  hashPassword: (_password: string) => ({ hash: "test-only-hash" }),
  invalidateSessionCache: () => undefined,
} });
mock.module("@/lib/db", { exports: {
  prisma: { student: { findFirst: async () => ({ id: "student-1", studentId: "learner", role: "student" }) } },
  prismaAdmin: {
    student: { update },
    passwordResetToken: { deleteMany: deleteTokens },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  },
} });
mock.module("@/lib/audit", { exports: { logAuditEvent: audit } });
mock.module("@/lib/logger", { exports: { logger: { error: mock.fn() } } });

let reset: typeof import("./[id]/reset-password/route").POST;
before(async () => {
  ({ POST: reset } = await import("./[id]/reset-password/route"));
});
beforeEach(() => {
  update.mock.resetCalls();
  deleteTokens.mock.resetCalls();
  audit.mock.resetCalls();
});

function resetWith(newPassword: string): Promise<Response> {
  const request = new Request("http://localhost/api/teacher/students/student-1/reset-password", {
    method: "POST",
    body: JSON.stringify({ newPassword }),
    headers: { "Content-Type": "application/json" },
  });
  return reset(request, { params: Promise.resolve({ id: "student-1" }) });
}

describe("instructor password reset: the student must change it", () => {
  it("marks the account in the same write that sets the password and ends its sessions", async () => {
    const response = await resetWith(generatePassword());

    assert.equal(response.status, 200);
    assert.equal(update.mock.callCount(), 1);
    const [{ where, data }] = update.mock.calls[0]?.arguments ?? [];
    assert.deepEqual(where, { id: "student-1", role: "student" });
    assert.equal(data.passwordHash, "test-only-hash");
    assert.equal(data.mustChangePassword, true);
    assert.deepEqual(data.sessionVersion, { increment: 1 });
  });

  it("still cancels the student's emailed reset links", async () => {
    await resetWith(generatePassword());

    assert.deepEqual(deleteTokens.mock.calls[0]?.arguments[0], { where: { studentId: "student-1" } });
  });

  it("writes an audit row that holds no password", async () => {
    const password = generatePassword();
    await resetWith(password);

    assert.equal(audit.mock.callCount(), 1);
    assert.equal(JSON.stringify(audit.mock.calls[0]?.arguments[0]).includes(password), false);
  });
});
