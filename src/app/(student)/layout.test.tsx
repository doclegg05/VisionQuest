import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { SECURITY_QUESTIONS } from "@/lib/security-questions";

// The student layout is the recovery-question gate. These cases pin who it
// sends to /recovery-setup: a real student with no questions, and nobody else.
// A demo account has no password to recover, so it must reach the app.

class RedirectSignal extends Error {}

let session: { id: string; studentId: string; displayName: string; role: string; demoAccount?: "student" | "instructor" } | null;
let questionKeys: string[];

mock.module("@/lib/auth", { exports: { getSession: async () => session } });

mock.module("next/navigation", {
  exports: {
    redirect: (to: string) => {
      throw new RedirectSignal(to);
    },
  },
});

mock.module("@/lib/db", {
  exports: {
    prisma: {
      goal: { count: async () => 0 },
      progression: { findUnique: async () => null },
      orientationProgress: { count: async () => 0 },
      securityQuestionAnswer: {
        findMany: async () => questionKeys.map((questionKey) => ({ questionKey })),
      },
    },
  },
});

// The chrome around the page is not under test.
mock.module("@/components/ui/NavBar", { exports: { default: () => null } });
mock.module("@/components/ui/NotificationProvider", {
  exports: { default: ({ children }: { children: unknown }) => children },
});
mock.module("@/components/progression/ProgressionProvider", {
  exports: { default: ({ children }: { children: unknown }) => children },
});
mock.module("@/components/ui/PageTransition", {
  exports: { PageTransition: ({ children }: { children: unknown }) => children },
});

let Layout: typeof import("./layout").default;

before(async () => {
  Layout = (await import("./layout")).default;
});

async function redirectTarget(): Promise<string | null> {
  try {
    await Layout({ children: null });
    return null;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.message;
    throw error;
  }
}

describe("student layout recovery gate", () => {
  beforeEach(() => {
    session = { id: "stu-1", studentId: "student1", displayName: "Test Student", role: "student" };
    questionKeys = [];
  });

  it("sends a real student with no recovery questions to setup", async () => {
    assert.equal(await redirectTarget(), "/recovery-setup");
  });

  it("lets a demo student in without recovery questions", async () => {
    session = { ...session!, demoAccount: "student" };

    assert.equal(await redirectTarget(), null);
  });

  it("lets a real student with the full set in", async () => {
    questionKeys = SECURITY_QUESTIONS.map((question) => question.key);

    assert.equal(await redirectTarget(), null);
  });

  it("sends a signed-out visitor to the home page", async () => {
    session = null;

    assert.equal(await redirectTarget(), "/");
  });
});
