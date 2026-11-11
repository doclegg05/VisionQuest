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

  it("calls onStop when pressed", () => {
    const onStop = () => undefined;
    const element = StopButton({ onStop });
    assert.equal(element.props.onClick, onStop);
  });
});
