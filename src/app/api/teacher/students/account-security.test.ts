import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { NextRequest } from "next/server";

const teacher: Session = { id: "teacher-1", studentId: "teacher", displayName: "Teacher", role: "teacher" };
let session: Session | null = teacher;
let authorizedStudent: { id: string; studentId: string; role: string } | null;
const update = mock.fn(async (_args: unknown) => ({}));
const deleteTokens = mock.fn(async (_args: unknown) => ({ count: 1 }));
const audit = mock.fn(async (_args: unknown) => undefined);
const archive = mock.fn(async (_id: string, _actor: string) => ({ storageKey: "archives/authorized-student/test.zip", fileCount: 1 }));
const presign = mock.fn(async (_key: string, _options: unknown) => "https://storage.example.test/archive");
const invalidate = mock.fn((_id: string) => undefined);
const findFirst = mock.fn(async (_args: unknown) => authorizedStudent);

// Real auth wrapper and classroom authorization; no database or credentials.
mock.module("@/lib/auth", { namedExports: {
  getSession: async () => session,
  hashPassword: () => ({ hash: "test-only-hash" }),
  invalidateSessionCache: invalidate,
} });
mock.module("@/lib/db", { namedExports: {
  prisma: { student: { findFirst, update } },
  prismaAdmin: {
    student: { update },
    passwordResetToken: { deleteMany: deleteTokens },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  },
} });
mock.module("@/lib/audit", { namedExports: {
  logAuditEvent: audit,
  tryLogAuditEvent: async (args: unknown) => { await audit(args); return { audited: true }; },
} });
mock.module("@/lib/storage", { namedExports: {
  downloadFile: async () => null,
  getPresignedDownloadUrl: presign,
} });
mock.module("@/lib/student-archive", { namedExports: { generateStudentArchive: archive } });
mock.module("@/lib/logger", { namedExports: { logger: { error: mock.fn() } } });

let reset: typeof import("./[id]/reset-password/route").POST;
let status: typeof import("./[id]/status/route").PATCH;
let archiveRoute: typeof import("./[id]/archive/route");
before(async () => {
  ({ POST: reset } = await import("./[id]/reset-password/route"));
  ({ PATCH: status } = await import("./[id]/status/route"));
  archiveRoute = await import("./[id]/archive/route");
});
beforeEach(() => {
  session = teacher;
  // A student's username equals another account's database ID.
  authorizedStudent = { id: "authorized-student", studentId: "other-account-id", role: "student" };
  for (const fn of [update, deleteTokens, audit, archive, invalidate, findFirst, presign]) fn.mock.resetCalls();
});

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/teacher/students/other-account-id", {
    method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
}
const context = () => ({ params: Promise.resolve({ id: "other-account-id" }) });
describe("archive privacy", () => {
  it("generates and audits only the authorized student's archive", async () => {
    const response = await archiveRoute.POST(new NextRequest("http://localhost", { method: "POST" }), context());
    assert.equal(response.status, 200);
    assert.equal(archive.mock.calls[0].arguments[0], "authorized-student");
    assert.equal((audit.mock.calls[0].arguments[0] as { targetId: string }).targetId, "authorized-student");
  });

  it("rejects an archive under the raw identifier's account", async () => {
    const req = new NextRequest("http://localhost?key=archives/other-account-id/test.zip");
    assert.equal((await archiveRoute.GET(req, context())).status, 400);
    assert.equal(presign.mock.callCount(), 0);
  });

  it("allows an archive under the resolved student's ID", async () => {
    const req = new NextRequest("http://localhost?key=archives/authorized-student/test.zip");
    assert.equal((await archiveRoute.GET(req, context())).status, 302);
    assert.equal(presign.mock.calls[0].arguments[0], "archives/authorized-student/test.zip");
  });
});

const cases = [
  { name: "password reset", call: () => reset(request("POST", { newPassword: "test-password-long" }), context()) },
  { name: "account deactivation", call: () => status(request("PATCH", { isActive: false }), context()) },
];

for (const route of cases) {
  describe(route.name, () => {
    it("mutates only the authorized canonical student, including audit/cache side effects", async () => {
      const response = await route.call();
      assert.equal(response.status, 200);
      assert.deepEqual(findFirst.mock.calls[0].arguments[0], {
        where: { AND: [
          { OR: [{ id: "other-account-id" }, { studentId: "other-account-id" }] },
          { role: "student" },
        ] },
        select: { id: true, displayName: true, studentId: true, role: true, isActive: true },
      });
      const mutation = update.mock.calls[0].arguments[0] as { where: unknown; data: { sessionVersion: unknown } };
      assert.deepEqual(mutation.where, {
        id: "authorized-student",
        ...(route.name === "password reset" ? { role: "student" } : {}),
      });
      assert.deepEqual(mutation.data.sessionVersion, { increment: 1 });
      assert.equal(invalidate.mock.calls[0].arguments[0], "authorized-student");
      assert.equal((audit.mock.calls[0].arguments[0] as { targetId: string }).targetId, "authorized-student");
      if (route.name === "password reset") {
        assert.deepEqual(deleteTokens.mock.calls[0].arguments[0], { where: { studentId: "authorized-student" } });
      } else {
        assert.equal(archive.mock.calls[0].arguments[0], "authorized-student");
      }
    });

    it("rejects an unmanaged identifier without mutations", async () => {
      authorizedStudent = null;
      assert.equal((await route.call()).status, 403);
      assert.equal(update.mock.callCount(), 0);
      assert.equal(deleteTokens.mock.callCount(), 0);
      assert.equal(archive.mock.callCount(), 0);
      assert.equal(invalidate.mock.callCount(), 0);
      assert.equal(audit.mock.callCount(), 0);
    });

    for (const role of [null, "student", "coordinator"] as const) {
      it(`rejects ${role ?? "anonymous"} callers before student lookup`, async () => {
        session = role ? { ...teacher, role } : null;
        assert.equal((await route.call()).status, role ? 403 : 401);
        assert.equal(findFirst.mock.callCount(), 0);
        assert.equal(update.mock.callCount(), 0);
      });
    }
  });
}
