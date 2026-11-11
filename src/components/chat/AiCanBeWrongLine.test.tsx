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
    const html = renderToString(<AiCanBeWrongLine />);
    assert.match(html, /Sage is an AI and can be wrong\./);
    assert.match(html, new RegExp(`<a[^>]*href="/about-sage"[^>]*>${SAGE_CHAT_NOTICE_LINK}</a>`));
  });

  it("agrees with the notice, which says Sage can make mistakes", () => {
    const section = SAGE_NOTICE_SECTIONS.find((s) => s.heading === "Sage Can Be Wrong");
    assert.ok(section?.sentences.includes("Sage can make mistakes."));
  });

  it("gives the link a 44px tall target", () => {
    const html = renderToString(<AiCanBeWrongLine />);
    assert.match(html, /<a[^>]*class="[^"]*\bmin-h-11\b[^"]*"/);
  });

  it("is not a live region and takes no focus on its own", () => {
    const html = renderToString(<AiCanBeWrongLine />);
    assert.doesNotMatch(html, /aria-live|role="(status|alert|log)"|autofocus|tabindex/i);
  });

  it("reads at grade 6 or below with no dashes", () => {
    for (const text of [SAGE_CHAT_AI_LINE, SAGE_CHAT_NOTICE_LINK]) {
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
