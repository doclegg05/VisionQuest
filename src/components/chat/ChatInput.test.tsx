import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import ChatInput, {
  CHAT_UPLOAD_ACCEPT,
  StopButton,
  UploadError,
  uploadFailureMessage,
  uploadProblemFor,
} from "./ChatInput";
import { validateFile } from "@/lib/storage";
import { composite, contrastRatio, cssTokenValue, parseColor } from "@/lib/wcag-contrast";
import { readFileSync } from "node:fs";

const MB = 1024 * 1024;
const DASHES = /[-‐-―−]/;

describe("chat file picker accept list", () => {
  // Types a phone or laptop commonly offers. The picker must accept exactly
  // the ones the upload route (validateFile) allows, no more and no fewer.
  const CANDIDATES = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/svg+xml",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  it("matches what the server allows", () => {
    const serverAllows = CANDIDATES.filter((type) => validateFile({ size: 1, type }) === null);
    assert.deepEqual(CHAT_UPLOAD_ACCEPT.split(","), serverAllows);
  });

  it("is on the file input", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} role="student" />);
    assert.match(html, new RegExp(`<input[^>]*type="file"[^>]*accept="${CHAT_UPLOAD_ACCEPT}"`));
  });
});

describe("uploadProblemFor", () => {
  it("passes a file the server would take", () => {
    const file = { size: 10 * MB, type: "image/png" };
    assert.equal(validateFile(file), null);
    assert.equal(uploadProblemFor(file), null);
  });

  it("stops a file the server would refuse, and says what to do", () => {
    for (const file of [
      { size: 10 * MB + 1, type: "image/png" },
      { size: 1, type: "image/heic" },
      { size: 0, type: "application/pdf" },
    ]) {
      assert.notEqual(validateFile(file), null);
      const problem = uploadProblemFor(file);
      assert.ok(problem, JSON.stringify(file));
      assert.match(problem!, /Pick /);
      assert.doesNotMatch(problem!, DASHES);
    }
  });
});

describe("uploadFailureMessage", () => {
  it("never shows the server's technical text and always says what to do", () => {
    for (const status of [400, 403, 413, 429, 500, null]) {
      const text = uploadFailureMessage(status);
      assert.doesNotMatch(text, DASHES, text);
      assert.doesNotMatch(text, /MIME|not allowed|storage/i, text);
      assert.match(text, /try again|Pick /i, text);
    }
  });
});

describe("uploadFailureMessage for a rate limit", () => {
  it("names the real window: the upload route allows 20 files an hour", () => {
    assert.equal(uploadFailureMessage(429), "You sent a lot of files this hour. Try again in one hour.");
  });
});

describe("UploadError", () => {
  it("uses the house error pattern: an icon beside the words", () => {
    const html = renderToString(<UploadError message={uploadFailureMessage(400)} />);
    assert.match(html, /flex items-start gap-2/);
    assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*class="shrink-0"/);
  });

  it("is announced, wraps a long message, and stays inside a phone screen", () => {
    const html = renderToString(<UploadError message={uploadFailureMessage(400)} />);
    assert.match(html, /role="alert"/);
    assert.match(html, /break-words/);
    assert.match(html, /min-w-0/);
    assert.doesNotMatch(html, /truncate|whitespace-nowrap/);
  });
});

describe("ChatInput while Sage answers", () => {
  it("keeps the message box focusable, so focus after Try again never falls to the page", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} disabled />);
    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? "";
    assert.ok(textarea, html);
    assert.doesNotMatch(textarea, / disabled=""/);
    assert.match(textarea, /readOnly=""|readonly=""/);
    assert.match(textarea, /aria-disabled="true"/);
  });
});

describe("Stop while Sage answers (E2.2)", () => {
  function stopButton(html: string): string {
    return html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Stop(?:(?!<\/button>)[\s\S])*<\/button>/)?.[0] ?? "";
  }

  it("shows a Stop button in place of Send while Sage answers", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} onStop={() => undefined} disabled />);
    const button = stopButton(html);
    assert.ok(button, html);
    assert.doesNotMatch(button, / disabled=""/);
    assert.match(button, /type="button"/);
    assert.doesNotMatch(html, /aria-label="Send message"/);
  });

  it("is a 44px target labelled Stop, with no failure colors", () => {
    const button = stopButton(renderToString(<ChatInput onSend={() => undefined} onStop={() => undefined} disabled />));
    assert.match(button, /min-h-11/);
    assert.match(button, /min-w-11/);
    assert.match(button, />Stop</);
    assert.doesNotMatch(button, /aria-label=/);
    assert.doesNotMatch(button, /error|danger/);
  });

  it("is gone once Sage is done, and Send is back", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} onStop={() => undefined} />);
    assert.equal(stopButton(html), "");
    assert.match(html, /aria-label="Send message"/);
  });

  it("never shows without an onStop (the mini chat has none)", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} disabled />);
    assert.equal(stopButton(html), "");
  });

  it("calls onStop when pressed once armed", () => {
    const onStop = () => undefined;
    const element = StopButton({ onStop, armed: true });
    assert.equal(element.props.onClick, onStop);
  });
});

describe("Stop before it is armed (E2b 1 and 2)", () => {
  function stopButton(html: string): string {
    return html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Stop(?:(?!<\/button>)[\s\S])*<\/button>/)?.[0] ?? "";
  }

  it("is drawn but aria-disabled until the chat arms it, so a double tap on Send is not a Stop", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} onStop={() => undefined} disabled />);
    const button = stopButton(html);
    assert.ok(button, html);
    assert.match(button, / aria-disabled="true"/);
    assert.doesNotMatch(button, / disabled=""/);
  });

  it("passes an unarmed press to the chat, whose gate decides (E2c 2)", () => {
    // send-abort.ts ignores a tap under 800 ms and keeps a later one until
    // the ids arrive, so the button itself must not drop the press.
    let calls = 0;
    const element = StopButton({ onStop: () => { calls += 1; }, armed: false });
    assert.equal(element.props["aria-disabled"], true);
    element.props.onClick();
    assert.equal(calls, 1);
  });

  it("looks dimmed while unarmed, with no hover change (E2c 1)", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} onStop={() => undefined} disabled />);
    const button = stopButton(html);
    assert.match(button, / aria-disabled="true"/);
    assert.match(button, /aria-disabled:opacity-70/);
    assert.match(button, /aria-disabled:hover:bg-\[var\(--chat-panel-bg\)\]/);
    assert.match(button, />Stop</);
    assert.match(button, /min-w-11/);
  });

  it("is full strength once armed: not aria-disabled, so the dim never applies (E2c 1)", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} onStop={() => undefined} stopArmed disabled />);
    const button = stopButton(html);
    assert.doesNotMatch(button, /aria-disabled="/);
    assert.doesNotMatch(button, /(?<!aria-disabled:)opacity-/);
    assert.match(button, /(?<!:)hover:bg-\[var\(--surface-interactive\)\]/);
  });

  it("drops aria-disabled once armed", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} onStop={() => undefined} stopArmed disabled />);
    assert.doesNotMatch(stopButton(html), /aria-disabled="/);
  });
});

describe("Stop stays full strength while Sage answers (E2b 5)", () => {
  it("fades the box and the other buttons, not the composer around Stop", () => {
    const html = renderToString(<ChatInput onSend={() => undefined} onStop={() => undefined} stopArmed disabled />);
    const composer = html.match(/<div class="relative flex flex-col[^"]*"/)?.[0] ?? "";
    assert.ok(composer, html);
    assert.doesNotMatch(composer, /opacity-/);
    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? "";
    assert.match(textarea, /opacity-75/);
    const stop = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Stop(?:(?!<\/button>)[\s\S])*<\/button>/)?.[0] ?? "";
    // Only the unarmed dim (aria-disabled:opacity-70), which an armed Stop never matches.
    assert.doesNotMatch(stop, /(?<!aria-disabled:)opacity/);
  });
});

describe("the Stop label's contrast in both themes (E2b 5)", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  for (const theme of ["light", "dark"] as const) {
    it(`reaches 4.5:1 on the composer in ${theme}`, () => {
      const ink = cssTokenValue(css, "--ink-strong", theme);
      const panel = cssTokenValue(css, "--chat-panel-bg", theme);
      const area = cssTokenValue(css, "--chat-area-bg", theme);
      assert.ok(ink && panel && area, "tokens are defined");
      const ground = composite(parseColor(panel!), parseColor(area!));
      const ratio = contrastRatio(composite(parseColor(ink!), parseColor(ground)), ground);
      assert.ok(ratio >= 4.5, `${theme}: ${ratio.toFixed(2)}:1`);
    });

    it(`still reaches 4.5:1 while unarmed (the whole button at 70%) in ${theme}`, () => {
      const ink = cssTokenValue(css, "--ink-strong", theme);
      const panel = cssTokenValue(css, "--chat-panel-bg", theme);
      const area = cssTokenValue(css, "--chat-area-bg", theme);
      assert.ok(ink && panel && area, "tokens are defined");
      const areaColor = parseColor(area!);
      const button = composite(parseColor(panel!), areaColor);
      const dim = (color: string) => composite({ ...parseColor(color), a: parseColor(color).a * 0.7 }, areaColor);
      const label = composite(parseColor(ink!), parseColor(button));
      const ratio = contrastRatio(dim(label), dim(button));
      assert.ok(ratio >= 4.5, `${theme} unarmed: ${ratio.toFixed(2)}:1`);
    });
  }
});
