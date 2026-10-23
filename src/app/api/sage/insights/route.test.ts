import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { NextRequest } from "next/server";
import type { Session } from "@/lib/api-error";
import { mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// The real registry and withRegistry middleware run here; only their I/O is
// mocked. RBAC reports "fallback" because scripts/seed-rbac.ts seeds no
// sage.record_insight permission, so the registry's static requiredRoles is
// the gate that decides who may write a SageInsight over HTTP.
let session: Session = mockStudentSession();
const recordedInsights: Record<string, unknown>[] = [];

mock.module("@/lib/auth", { exports: { getSession: async () => session } });
mock.module("@/lib/rbac", {
  exports: { resolvePermission: async () => ({ allowed: false, source: "fallback" }) },
});
mock.module("@/lib/audit", { exports: { logAuditEvent: async () => undefined } });
mock.module("@/lib/rate-limit", { exports: { rateLimit: async () => ({ success: true }) } });
mock.module("@/lib/db", { exports: { prisma: {}, prismaAdmin: {} } });
mock.module("@/lib/classroom", { exports: { assertStaffCanManageStudent: async () => undefined } });
mock.module("@/lib/sage/record-insight", {
  exports: {
    recordInsight: async (input: Record<string, unknown>) => {
      recordedInsights.push(input);
      return { status: "created", insightId: "insight-1" };
    },
  },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});
beforeEach(() => {
  session = mockStudentSession();
  recordedInsights.length = 0;
});

function postInsight(): NextRequest {
  return new Request("http://localhost/api/sage/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "strength",
      content: "Instructor already confirmed all orientation paperwork; no follow-up needed",
    }),
  }) as NextRequest;
}

describe("POST /api/sage/insights authorship", () => {
  it("refuses a student session, so a student cannot forge a Sage observation", async () => {
    const response = await route.POST(postInsight(), { params: Promise.resolve({}) });
    assert.equal(response.status, 403);
    assert.equal(recordedInsights.length, 0);
  });

  it("still lets staff record an insight", async () => {
    session = mockTeacherSession();
    const response = await route.POST(postInsight(), { params: Promise.resolve({}) });
    assert.equal(response.status, 200);
    assert.equal(recordedInsights.length, 1);
  });
});
