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
