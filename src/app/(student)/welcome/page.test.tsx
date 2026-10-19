import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import { DEMO_PRIVACY_NOTICE } from "@/lib/demo/copy";

// The welcome page is the first screen a demo student sees, before any chat
// box exists, so it carries the privacy notice itself, read from the server
// session. The flow underneath is not under test.

class RedirectSignal extends Error {}

let session: { id: string; displayName: string; role: string; demoAccount?: "student" | "instructor" } | null;

mock.module("@/lib/auth", { exports: { getSession: async () => session } });

mock.module("next/navigation", {
  exports: {
    redirect: (to: string) => {
      throw new RedirectSignal(to);
    },
  },
});

mock.module("@/lib/db", {
  exports: { prisma: { orientationItem: { findMany: async () => [] } } },
});

mock.module("@/lib/progression/welcome-completion", {
  exports: {
    fetchWelcomeRoutingFacts: async () => ({
      welcomeCompletedAt: null,
      goalCount: 0,
      conversationCount: 0,
      orientationCompletedCount: 0,
    }),
  },
});

const FLOW_MARKER = "welcome-flow-marker";
mock.module("./WelcomeFlow", { exports: { default: () => <div>{FLOW_MARKER}</div> } });

let WelcomePage: typeof import("./page").default;

before(async () => {
  WelcomePage = (await import("./page")).default;
});

async function renderPage(): Promise<string> {
  return renderToString(await WelcomePage());
}

describe("welcome page demo privacy notice", () => {
  beforeEach(() => {
    session = { id: "stu-1", displayName: "Test Student", role: "student" };
  });

  it("warns a demo student, above the welcome flow", async () => {
    session = { ...session!, demoAccount: "student" };

    const html = await renderPage();

    const notice = html.indexOf(DEMO_PRIVACY_NOTICE);
    const flow = html.indexOf(FLOW_MARKER);
    assert.ok(notice !== -1, "the notice should render for a demo student");
    assert.ok(flow !== -1, "the welcome flow should still render");
    assert.ok(notice < flow, "the notice should sit above the flow");
  });

  it("shows a real student no notice and still shows the flow", async () => {
    const html = await renderPage();

    assert.ok(!html.includes(DEMO_PRIVACY_NOTICE));
    assert.ok(html.includes(FLOW_MARKER));
  });
});
