import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { mockAdminSession, mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// R9: no student adds a personal AI key. Saving one is staff only; removing
// one stays open to every role, so a student who saved a key before R9 can
// still take it out.

let session: Session | null = mockStudentSession();
const updates: Array<Record<string, unknown>> = [];
let keyChecks = 0;

mock.module("@/lib/auth", { exports: { getSession: async () => session } });
mock.module("@/lib/db", {
  exports: {
    prisma: {
      student: {
        update: async (args: Record<string, unknown>) => {
          updates.push(args);
          return {};
        },
      },
    },
  },
});
mock.module("@/lib/audit", { exports: { logAuditEvent: async () => undefined } });
mock.module("@/lib/rate-limit", { exports: { rateLimit: async () => ({ success: true }) } });
mock.module("@/lib/crypto", { exports: { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v } });
mock.module("@/lib/ai/demo-local-only", { exports: { isDemoLocalOnlyRequired: () => false } });
mock.module("@/lib/ai/gemini-provider", {
  exports: {
    GeminiProvider: class {
      async generateResponse() {
        keyChecks += 1;
        return "hi";
      }
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  updates.length = 0;
  keyChecks = 0;
});

function save() {
  return route.POST(
    mockRequest("/api/settings/api-key", { method: "POST", body: { apiKey: "AIzaTestKey123" } }) as never,
  );
}

describe("POST /api/settings/api-key", () => {
  it("refuses a student, before testing or saving anything", async () => {
    session = mockStudentSession();
    const res = await save();
    assert.equal(res.status, 403);
    assert.equal(keyChecks, 0);
    assert.equal(updates.length, 0);
  });

  for (const [label, make] of [
    ["teacher", mockTeacherSession],
    ["admin", mockAdminSession],
  ] as const) {
    it(`lets a ${label} save a key`, async () => {
      session = make();
      const res = await save();
      assert.equal(res.status, 200);
      assert.equal(updates.length, 1);
    });
  }
});

describe("DELETE /api/settings/api-key", () => {
  it("still lets a student remove a key they saved", async () => {
    session = mockStudentSession();
    const res = await route.DELETE();
    assert.equal(res.status, 200);
    assert.deepEqual(updates[0], { where: { id: session.id }, data: { geminiApiKey: null } });
  });
});
