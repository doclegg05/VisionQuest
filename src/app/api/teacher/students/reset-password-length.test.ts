import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import type { Session } from "@/lib/api-error";
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE, generatePassword } from "@/lib/password-policy";

/**
 * The instructor reset enforces the one password rule.
 *
 * The reset screen told instructors "6+ chars" while this route asked for 12,
 * so a reset typed as told came back 400. The screen now reads
 * MIN_PASSWORD_LENGTH; these tests hold the route to the same constant and to
 * the message built from it.
 */

const teacher: Session = { id: "teacher-1", studentId: "teacher", displayName: "Teacher", role: "teacher" };
const hash = mock.fn((_password: string) => ({ hash: "test-only-hash" }));
const update = mock.fn(async (_args: unknown) => ({}));

// The real auth wrapper and classroom check run; there is no database.
mock.module("@/lib/auth", { exports: {
  getSession: async () => teacher,
  hashPassword: hash,
  invalidateSessionCache: () => undefined,
} });
mock.module("@/lib/db", { exports: {
  prisma: { student: { findFirst: async () => ({ id: "student-1", studentId: "learner", role: "student" }) } },
  prismaAdmin: {
    student: { update },
    passwordResetToken: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  },
} });
mock.module("@/lib/audit", { exports: { logAuditEvent: async () => undefined } });
mock.module("@/lib/logger", { exports: { logger: { error: mock.fn() } } });

let reset: typeof import("./[id]/reset-password/route").POST;
before(async () => {
  ({ POST: reset } = await import("./[id]/reset-password/route"));
});
beforeEach(() => {
  hash.mock.resetCalls();
  update.mock.resetCalls();
});

function resetWith(newPassword: string): Promise<Response> {
  const request = new Request("http://localhost/api/teacher/students/student-1/reset-password", {
    method: "POST",
    body: JSON.stringify({ newPassword }),
    headers: { "Content-Type": "application/json" },
  });
  return reset(request, { params: Promise.resolve({ id: "student-1" }) });
}

async function errorOf(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
}

describe("instructor password reset: length", () => {
  it("refuses one character under the rule, with the message built from the constant", async () => {
    const response = await resetWith("a".repeat(MIN_PASSWORD_LENGTH - 1));

    assert.equal(response.status, 400);
    assert.equal(await errorOf(response), PASSWORD_TOO_SHORT_MESSAGE);
    assert.equal(hash.mock.callCount(), 0);
    assert.equal(update.mock.callCount(), 0);
  });

  it("accepts a password exactly as long as the rule", async () => {
    const response = await resetWith("a".repeat(MIN_PASSWORD_LENGTH));

    assert.equal(response.status, 200);
    assert.equal(update.mock.callCount(), 1);
  });

  it("accepts a password from the Make a password button", async () => {
    assert.equal((await resetWith(generatePassword())).status, 200);
  });
});
