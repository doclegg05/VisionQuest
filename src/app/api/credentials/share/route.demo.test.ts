import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_PUBLIC_PAGE_REFUSAL } from "@/lib/demo/copy";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// Cohort demo mode: a public credential page is reachable by anyone with the
// link, so a demo account may not make one. The proxy does not cover a demo
// student on this route, so the guard here is the only layer. `@/lib/api-error`
// stays REAL, so withAuth turns the guard's ApiError into the 403 a browser
// would see. Every stub records its name in `touched`, which proves the refusal
// happened before any read or write.

const touched: string[] = [];
const touch = (name: string, value: unknown = null) => async () => {
  touched.push(name);
  return value;
};

let session: Session = mockStudentSession();

mock.module("@/lib/auth", { exports: { getSession: async () => session } });

mock.module("@/lib/db", {
  exports: {
    prisma: {
      certification: {
        findFirst: touch("certification.findFirst", {
          id: "cert-1",
          status: "completed",
          completedAt: new Date(),
        }),
      },
      publicCredentialPage: {
        findUnique: touch("publicCredentialPage.findUnique"),
        upsert: touch("publicCredentialPage.upsert", { slug: "demo", isPublic: false }),
      },
    },
  },
});

mock.module("@/lib/advising", { exports: { syncStudentAlerts: touch("syncStudentAlerts") } });

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

function shareRequest() {
  return mockRequest("/api/credentials/share", {
    method: "POST",
    body: { isPublic: true, headline: "Hello", summary: "World" },
  });
}

describe("POST /api/credentials/share and demo accounts", () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it("refuses a demo account and creates no public page", async () => {
    const demoSessions: Session[] = [
      mockStudentSession({ demoAccount: "student" }),
      mockTeacherSession({ demoAccount: "instructor" }),
    ];

    for (const demoSession of demoSessions) {
      session = demoSession;
      const res = await route.POST(shareRequest());

      assert.equal(res.status, 403, `${demoSession.demoAccount} should be refused`);
      assert.equal(((await res.json()) as { error: string }).error, DEMO_PUBLIC_PAGE_REFUSAL);
      assert.deepEqual(touched, [], `${demoSession.demoAccount} should do no work`);
    }
  });

  it("still lets a demo student read the credential page state", async () => {
    session = mockStudentSession({ demoAccount: "student" });

    const res = await route.GET(mockRequest("/api/credentials/share"));

    assert.equal(res.status, 200);
  });

  it("still saves the page for a real student", async () => {
    session = mockStudentSession();

    const res = await route.POST(shareRequest());

    assert.equal(res.status, 200);
    assert.ok(touched.includes("publicCredentialPage.upsert"), "the page should be written");
  });
});
