import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";

import { AiCanBeWrongLine } from "./AiCanBeWrongLine";
import ChatInput from "./ChatInput";
import type { ChatRole } from "@/lib/chat/commands";
import {
  SAGE_CHAT_AI_LINE,
  SAGE_CHAT_NOTICE_LINK,
  SAGE_CHAT_NOTICE_NEW_TAB,
  SAGE_NOTICE_PATH,
  SAGE_NOTICE_SECTIONS,
} from "@/lib/about-sage/notice";
import { assessReadability } from "@/lib/sage/readability";
import { composite, contrastRatio, cssTokenValue, parseColor } from "@/lib/wcag-contrast";

// E6: one line under the message box says Sage is an AI and can be wrong,
// with a link to the full notice students can read at any time.

const ROLES: readonly ChatRole[] = ["student", "teacher", "admin", "coordinator"];
const DASHES = /[-‐-―−]/;

describe("the AI can be wrong line", () => {
  it("says the plan's sentence and links to the read any time notice", () => {
    assert.equal(SAGE_CHAT_AI_LINE, "Sage is an AI and can be wrong.");
    assert.equal(SAGE_NOTICE_PATH, "/about-sage");
    const html = renderToString(<AiCanBeWrongLine showLink />);
    assert.match(html, /Sage is an AI and can be wrong\./);
    const text = `${SAGE_CHAT_NOTICE_LINK} ${SAGE_CHAT_NOTICE_NEW_TAB}`.replace(/[()]/g, "\\$&");
    assert.match(html, new RegExp(`<a[^>]*href="/about-sage"[^>]*>${text}</a>`));
  });

  it("opens the notice in a new tab, so the typed message and a reply in progress stay", () => {
    const html = renderToString(<AiCanBeWrongLine showLink />);
    assert.match(html, /<a[^>]*target="_blank"[^>]*>/);
    assert.match(html, /<a[^>]*rel="noopener noreferrer"[^>]*>/);
  });

  it("is the sentence alone when it has no link", () => {
    const html = renderToString(<AiCanBeWrongLine />);
    assert.match(html, /Sage is an AI and can be wrong\./);
    assert.doesNotMatch(html, /<a\b/);
  });

  it("agrees with the notice, which says Sage can make mistakes", () => {
    const section = SAGE_NOTICE_SECTIONS.find((s) => s.heading === "Sage Can Be Wrong");
    assert.ok(section?.sentences.includes("Sage can make mistakes."));
  });

  it("gives the link a 44px tall target", () => {
    const html = renderToString(<AiCanBeWrongLine showLink />);
    // Padding gives the 44px target; the row itself stays one text line tall.
    const linkClass = html.match(/<a[^>]*class="([^"]*)"/)?.[1].split(" ") ?? [];
    assert.ok(linkClass.includes("py-3") && linkClass.includes("-my-3"), linkClass.join(" "));
    assert.doesNotMatch(html, /min-h-11/);
  });

  it("is not a live region and takes no focus on its own", () => {
    const html = renderToString(<AiCanBeWrongLine showLink />);
    assert.doesNotMatch(html, /aria-live|role="(status|alert|log)"|autofocus|tabindex/i);
  });

  it("reads at grade 6 or below with no dashes", () => {
    for (const text of [SAGE_CHAT_AI_LINE, SAGE_CHAT_NOTICE_LINK, SAGE_CHAT_NOTICE_NEW_TAB]) {
      const { grade } = assessReadability(text);
      assert.ok(grade <= 6, `"${text}" grade ${grade}`);
      assert.doesNotMatch(text, DASHES);
    }
  });
});

describe("ChatInput shows the line under the message box", () => {
  for (const role of ROLES) {
    for (const compact of [false, true]) {
      it(`for ${role}${compact ? " in the small chat" : ""}, after the box and Send in tab order`, () => {
        const html = renderToString(<ChatInput onSend={() => undefined} role={role} compact={compact} />);
        const box = html.indexOf("<textarea");
        const send = html.indexOf('aria-label="Send message"');
        const line = html.indexOf(SAGE_CHAT_AI_LINE);
        assert.ok(box >= 0 && send >= 0, "box and Send render");
        assert.ok(line > box && line > send, "the line comes after the box and Send");
        assert.doesNotMatch(html, /aria-live/);
        // The full chat has "About Sage" in its header; only the small chat links,
        // and only for students, since the notice is written to students.
        const links = html.includes(`href="${SAGE_NOTICE_PATH}"`);
        assert.equal(links, compact && role === "student", `link shown: ${links}`);
      });
    }
  }
});

describe("the line's muted text in both themes", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  // The full chat sits on --chat-area-bg; the small chat panel on --chat-panel-bg.
  for (const theme of ["light", "dark"] as const) {
    for (const groundToken of ["--chat-area-bg", "--chat-panel-bg"]) {
      it(`meets 4.5:1 on ${groundToken} in ${theme}`, () => {
        const ink = cssTokenValue(css, "--ink-muted", theme);
        const ground = cssTokenValue(css, groundToken, theme);
        assert.ok(ink && ground, "both tokens are defined");
        const ratio = contrastRatio(composite(parseColor(ink!), parseColor(ground!)), ground!);
        assert.ok(ratio >= 4.5, `${theme} ${groundToken}: ${ratio.toFixed(2)}:1`);
      });
    }
  }
});
