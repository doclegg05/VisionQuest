import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import ChatInput from "@/components/chat/ChatInput";
import { DEMO_PRIVACY_NOTICE } from "@/lib/demo/copy";
import { SECURITY_QUESTIONS } from "@/lib/security-questions";
import { SAGE_NOTICE_VERSION } from "@/lib/about-sage/notice";

// The student layout is the recovery-question gate. These cases pin who it
// sends to /recovery-setup: a real student with no questions, and nobody else.
// A demo account has no password to recover, so it must reach the app.

class RedirectSignal extends Error {}

let session: { id: string; studentId: string; displayName: string; role: string; demoAccount?: "student" | "instructor" } | null;
let questionKeys: string[];
// Scopes of the student's open ConsentRecord rows (the Sage notice is one).
let consentScopes: string[];
const CURRENT_NOTICE = `sage_notice:${SAGE_NOTICE_VERSION}`;

mock.module("@/lib/auth", { exports: { getSession: async () => session } });

mock.module("next/navigation", {
  exports: {
    redirect: (to: string) => {
      throw new RedirectSignal(to);
    },
  },
});

const prismaMock = {
  goal: { count: async () => 0 },
  progression: { findUnique: async () => null },
  orientationProgress: { count: async () => 0 },
  securityQuestionAnswer: {
    findMany: async () => questionKeys.map((questionKey) => ({ questionKey })),
  },
  consentRecord: {
    findFirst: async ({ where }: { where: { studentId: string; scope: string; revokedAt: null } }) =>
      where.studentId === session?.id && where.revokedAt === null && consentScopes.includes(where.scope)
        ? { id: "ack" }
        : null,
  },
};

mock.module("@/lib/db", {
  exports: {
    prisma: prismaMock,
    // The layout's nav facts are read in one transaction (getStudentShell).
    withAppTransaction: async <T,>(work: (tx: typeof prismaMock) => Promise<T>) => work(prismaMock),
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
    consentScopes = [CURRENT_NOTICE];
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

// The layout is where a demo student's account kind reaches the client tree.
// Rendering a real ChatInput as the layout's child proves the whole chain:
// session -> provider value -> useDemoAccount -> notice.
describe("student layout demo privacy notice", () => {
  beforeEach(() => {
    session = { id: "stu-1", studentId: "student1", displayName: "Test Student", role: "student" };
    questionKeys = SECURITY_QUESTIONS.map((question) => question.key);
    consentScopes = [CURRENT_NOTICE];
  });

  async function renderLayoutWithChatInput(): Promise<string> {
    const tree = await Layout({ children: <ChatInput onSend={() => {}} /> });
    return renderToString(tree);
  }

  it("warns a demo student next to the message box", async () => {
    session = { ...session!, demoAccount: "student" };

    assert.ok((await renderLayoutWithChatInput()).includes(DEMO_PRIVACY_NOTICE));
  });

  it("shows a real student no notice", async () => {
    assert.ok(!(await renderLayoutWithChatInput()).includes(DEMO_PRIVACY_NOTICE));
  });
});

// The Sage notice gate (H6). Forced steps run in this order: the password
// change (src/proxy.ts, before any page), then this notice, then recovery
// questions. The notice page lives outside the (student) group, so the
// redirect cannot loop.
describe("student layout Sage notice gate", () => {
  beforeEach(() => {
    session = { id: "stu-1", studentId: "student1", displayName: "Test Student", role: "student" };
    questionKeys = SECURITY_QUESTIONS.map((question) => question.key);
    consentScopes = [];
  });

  it("sends a student who has not acknowledged the notice to it", async () => {
    assert.equal(await redirectTarget(), "/sage-notice");
  });

  it("lets a student who acknowledged the current notice in", async () => {
    consentScopes = [CURRENT_NOTICE];

    assert.equal(await redirectTarget(), null);
  });

  it("asks again when the student acknowledged only an older notice", async () => {
    consentScopes = ["sage_notice:2020-01-01"];

    assert.equal(await redirectTarget(), "/sage-notice");
  });

  it("does not ask a demo student", async () => {
    session = { ...session!, demoAccount: "student" };

    assert.equal(await redirectTarget(), null);
  });

  it("asks for the notice before the recovery questions", async () => {
    questionKeys = [];

    assert.equal(await redirectTarget(), "/sage-notice");
  });

  it("sends a teacher or an admin to their own home without asking", async () => {
    session = { ...session!, role: "teacher" };
    assert.equal(await redirectTarget(), "/teacher");

    session = { ...session!, role: "admin" };
    assert.equal(await redirectTarget(), "/admin");

    session = { ...session!, role: "coordinator" };
    assert.equal(await redirectTarget(), "/coordinator");
  });
});
