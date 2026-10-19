import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import { SECURITY_QUESTIONS } from "@/lib/security-questions";

// Cohort demo mode: a demo account has no password to recover, so this page
// sends it on to the dashboard instead of asking for recovery questions. The
// student layout asks the same question (needsRecoverySetup) before it sends
// anyone here, so the two cannot bounce a student back and forth.

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
      securityQuestionAnswer: {
        findMany: async () => questionKeys.map((questionKey) => ({ questionKey })),
      },
    },
  },
});

mock.module("@/components/auth/RecoverySetupForm", {
  exports: { default: () => null },
});

let Page: typeof import("./page").default;

before(async () => {
  Page = (await import("./page")).default;
});

async function redirectTarget(): Promise<string | null> {
  try {
    await Page();
    return null;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.message;
    throw error;
  }
}

describe("recovery setup page", () => {
  beforeEach(() => {
    session = { id: "stu-1", studentId: "student1", displayName: "Test Student", role: "student" };
    questionKeys = [];
  });

  it("sends a demo student on to the dashboard", async () => {
    session = { ...session!, demoAccount: "student" };

    assert.equal(await redirectTarget(), "/dashboard");
  });

  it("shows the setup form to a real student with no recovery questions", async () => {
    assert.equal(await redirectTarget(), null);

    const html = renderToString(await Page());
    assert.ok(html.includes("Keep your account safe"));
  });

  it("sends a real student who already finished setup to the dashboard", async () => {
    questionKeys = SECURITY_QUESTIONS.map((question) => question.key);

    assert.equal(await redirectTarget(), "/dashboard");
  });

  it("sends a signed-out visitor to the home page", async () => {
    session = null;

    assert.equal(await redirectTarget(), "/");
  });
});
