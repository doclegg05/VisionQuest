import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import {
  SAGE_NOTICE_ACK_BUTTON,
  SAGE_NOTICE_ACK_HEADING,
  SAGE_NOTICE_ACK_INTRO,
  SAGE_NOTICE_SIGN_OUT_BUTTON,
  SAGE_NOTICE_SIGN_OUT_LINE,
  SAGE_NOTICE_KEY_POINTS,
  SAGE_NOTICE_PATH,
  SAGE_NOTICE_VERSION,
} from "@/lib/about-sage/notice";

// The acknowledgement screen the student layout sends a student to. It sits
// outside the (student) group, so asking the same question as the layout
// (needsSageNotice) is what stops the two from bouncing a student.

class RedirectSignal extends Error {}

/** How renderToString writes quote marks in text. */
function asHtml(text: string): string {
  return text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
}

let session: { id: string; studentId: string; displayName: string; role: string; demoAccount?: "student" | "instructor" } | null;
let consentScopes: string[];

mock.module("@/lib/auth", { exports: { getSession: async () => session } });
mock.module("next/navigation", {
  exports: {
    redirect: (to: string) => {
      throw new RedirectSignal(to);
    },
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  },
});
mock.module("@/lib/db", {
  exports: {
    prisma: {
      consentRecord: {
        findFirst: async ({ where }: { where: { studentId: string; scope: string } }) =>
          where.studentId === session?.id && consentScopes.includes(where.scope) ? { id: "ack" } : null,
      },
    },
  },
});

let Page: typeof import("./page").default;
let pageMetadata: typeof import("./page").metadata;

before(async () => {
  const mod = await import("./page");
  Page = mod.default;
  pageMetadata = mod.metadata;
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

describe("/sage-notice acknowledgement page", () => {
  beforeEach(() => {
    session = { id: "stu-1", studentId: "student1", displayName: "Test Student", role: "student" };
    consentScopes = [];
  });

  it("shows the short notice, a link to the full one, and the button", async () => {
    assert.equal(await redirectTarget(), null);
    const html = renderToString(await Page());

    assert.match(html, new RegExp(`<h1[^>]*>${SAGE_NOTICE_ACK_HEADING}</h1>`));
    for (const point of SAGE_NOTICE_KEY_POINTS) assert.ok(html.includes(asHtml(point)), point);
    assert.match(html, new RegExp(`<a[^>]*href="${SAGE_NOTICE_PATH}"`));
    assert.match(html, new RegExp(`<button[^>]*>${SAGE_NOTICE_ACK_BUTTON}</button>`));
  });

  it("tells the student what Sage is and what to do, right under the heading", async () => {
    const html = renderToString(await Page());
    const afterHeading = html.slice(html.indexOf("</h1>"));
    assert.ok(afterHeading.startsWith(`</h1><p`), "the intro is the next element");
    assert.ok(afterHeading.indexOf(SAGE_NOTICE_ACK_INTRO) < afterHeading.indexOf("<ul"));
  });

  it("offers a way out: sign out, under a divider, after the button", async () => {
    const html = renderToString(await Page());
    const block = html.slice(html.indexOf(`>${SAGE_NOTICE_ACK_BUTTON}</button>`));
    assert.match(block, /class="mt-6 border-t border-\[var\(--border\)\] pt-4"/);
    assert.ok(block.includes(SAGE_NOTICE_SIGN_OUT_LINE));
    assert.match(block, new RegExp(`<button[^>]*>${SAGE_NOTICE_SIGN_OUT_BUTTON}</button>`));
  });

  it("names the page in the browser tab", () => {
    assert.equal(pageMetadata.title, "Before You Talk to Sage | VisionQuest");
  });

  it("sends a student who already acknowledged this version to the dashboard", async () => {
    consentScopes = [`sage_notice:${SAGE_NOTICE_VERSION}`];
    assert.equal(await redirectTarget(), "/dashboard");
  });

  it("asks a student who acknowledged only an older version", async () => {
    consentScopes = ["sage_notice:2020-01-01"];
    assert.equal(await redirectTarget(), null);
  });

  it("sends a demo student to the dashboard without asking", async () => {
    session = { ...session!, demoAccount: "student" };
    assert.equal(await redirectTarget(), "/dashboard");
  });

  it("sends staff to their own home", async () => {
    session = { ...session!, role: "teacher" };
    assert.equal(await redirectTarget(), "/teacher");
  });

  it("sends a signed-out visitor to sign in", async () => {
    session = null;
    assert.equal(await redirectTarget(), "/");
  });
});
