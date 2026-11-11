import { afterEach, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

// F19: anyone can write a /chat?prompt= or ?topic=&name= link, so the text it
// carries must only prefill the input box. The student reads it and presses
// Send; nothing reaches /api/chat/send on page load.

let searchParams = new URLSearchParams();
mock.module("next/navigation", {
  namedExports: { useSearchParams: () => searchParams },
});

const apiFetchUrls: string[] = [];
mock.module("@/lib/api", {
  namedExports: {
    apiFetch: async (url: string) => {
      apiFetchUrls.push(url);
      return new Response(null, { status: 500 });
    },
  },
});

// Server rendering never runs effects, and the old auto-send was scheduled from
// a mount effect. Run each effect once, synchronously, during render so a send
// scheduled on mount shows up here without a DOM.
const runEffectNow = (effect: React.EffectCallback) => {
  effect();
};
mock.module("react", {
  namedExports: { ...React, useEffect: runEffectNow },
  defaultExport: { ...React, useEffect: runEffectNow },
});

// next/link runs effects (prefetch) that need the app router; the effect mock
// above would run them during a server render and fail the whole page. The
// About Sage test reads the source to prove the real component is Link.
mock.module("next/link", {
  defaultExport: ({ href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...rest }),
});

// Imported after the mocks register: a static import is hoisted and would bind
// the real modules.
let ChatWindow: typeof import("./ChatWindow").default;

before(async () => {
  mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  ChatWindow = (await import("./ChatWindow")).default;
});

afterEach(() => {
  mock.timers.reset();
  apiFetchUrls.length = 0;
});

/** The text inside the chat input box, as server-rendered. */
function inputBoxText(html: string): string | undefined {
  return /<textarea[^>]*>([^<]*)<\/textarea>/.exec(html)?.[1];
}

function renderAndWait(params: Record<string, string>, role: "student" | "teacher"): string {
  searchParams = new URLSearchParams(params);
  mock.timers.enable({ apis: ["setTimeout"] });
  const html = renderToString(<ChatWindow role={role} />);
  // Well past the old 500 ms auto-send delay.
  mock.timers.tick(5_000);
  return html;
}

describe("ChatWindow deep links (F19: prefill, never auto-send)", () => {
  for (const role of ["student", "teacher"] as const) {
    it(`puts ?prompt= text in the ${role} input box and posts nothing`, () => {
      const html = renderAndWait({ prompt: "  Help me plan my week  " }, role);

      assert.ok(
        !apiFetchUrls.includes("/api/chat/send"),
        `a deep link must not send a message on load; apiFetch calls: ${apiFetchUrls.join(", ")}`,
      );
      assert.equal(inputBoxText(html), "Help me plan my week");
    });
  }

  it("fills the ?topic=form&name= template into the input box and posts nothing", () => {
    const html = renderAndWait({ topic: "form", name: "Attendance Policy" }, "student");

    assert.ok(!apiFetchUrls.includes("/api/chat/send"));
    assert.equal(
      inputBoxText(html),
      "Can you tell me about the &quot;Attendance Policy&quot; form? What is it for and what do I need to know about it?",
    );
  });

  it("keeps the 1000-character cap on ?prompt= text", () => {
    const html = renderAndWait({ prompt: "a".repeat(1_200) }, "student");

    assert.equal(inputBoxText(html), "a".repeat(1_000));
  });
});

// H6: the chat header links to the Sage notice. The header, not the input
// area: another task adds an "AI can be wrong" line under the message box.
describe("ChatWindow link to the Sage notice", () => {
  it("links the chat header to the notice page", async () => {
    const { SAGE_NOTICE_PATH, SAGE_NOTICE_LINK_LABEL } = await import("@/lib/about-sage/notice");
    const html = renderAndWait({}, "student");

    const link = new RegExp(`<a[^>]*href="${SAGE_NOTICE_PATH}"[^>]*>${SAGE_NOTICE_LINK_LABEL}</a>`);
    assert.match(html, link);
    const header = html.slice(0, html.indexOf('role="log"'));
    assert.match(header, link, "the link sits in the header, above the conversation");
  });

  it("uses body-size text and a client-side Link for it", async () => {
    const { readFileSync } = await import("node:fs");
    const html = renderAndWait({}, "student");
    const anchor = html.match(/<a[^>]*href="\/about-sage"[^>]*>/)?.[0] ?? "";
    assert.match(anchor, /\btext-sm\b/);
    assert.doesNotMatch(anchor, /\btext-xs\b/);
    // renderToString draws Link as a plain <a>, so the source is the only place to tell them apart.
    const source = readFileSync("src/components/chat/ChatWindow.tsx", "utf8");
    assert.match(source, /<Link\s+href="\/about-sage"/);
    assert.doesNotMatch(source, /<a\s+href="\/about-sage"/);
  });
});

describe("the conversation log while Sage answers (E1c 8)", () => {
  it("tells screen readers when the log is busy, so a streamed reply is not read twice", () => {
    const html = renderToString(<ChatWindow role="student" />);
    assert.match(html, /role="log"[^>]*aria-busy="false"/);
  });
});

describe("ChatWindow wires the wait and Stop pieces (E2)", () => {
  // renderToString cannot press Send, so the source is checked for the wiring;
  // the behavior itself is tested in wait-and-stop.test.ts, TypingIndicator
  // and ChatInput.
  it("passes Stop, the wait words, the abort signal and the opener rule", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/components/chat/ChatWindow.tsx", "utf8");
    assert.match(source, /onStop=\{stopReply\}/);
    assert.match(source, /<TypingIndicator slow=\{slowReply\} \/>/);
    assert.match(source, /signal: controller\.signal/);
    assert.match(source, /showsCannedOpener\(\{ role, isFirstMessage, localProvider \}\)/);
    assert.match(source, /onCrisisBlock:/);
  });

  it("arms Stop from the first event's ids and marks the log busy only while words stream (E2b 1 to 3)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/components/chat/ChatWindow.tsx", "utf8");
    assert.match(source, /stopArmed=\{sendAbort\.isArmed\}/);
    assert.match(source, /sendAbort\.noteIds\(\)/);
    assert.match(source, /aria-busy=\{logBusy\(isLoading, streamingContent\)\}/);
  });

  it("says why leaving the page does not abort the reply (E2b 9)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/components/chat/ChatWindow.tsx", "utf8");
    assert.match(source, /deliberately does not abort/);
  });

  it("keeps handleSend under 50 lines and the file under 700 (E2b 7)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/components/chat/ChatWindow.tsx", "utf8");
    const lines = source.split("\n");
    assert.ok(lines.length < 700, String(lines.length));
    const start = lines.findIndex((line) => /const handleSend = useCallback\(/.test(line));
    const end = lines.findIndex((line, i) => i > start && /^  \);$/.test(line));
    assert.ok(start >= 0 && end > start, "handleSend not found");
    assert.ok(end - start + 1 <= 50, `handleSend is ${end - start + 1} lines`);
  });

  it("renders with the local provider flag", () => {
    const html = renderToString(<ChatWindow role="student" localProvider />);
    assert.match(html, /role="log"/);
  });
});
